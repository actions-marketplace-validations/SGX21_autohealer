/**
 * analyze-failure.mjs — AutoHealer
 *
 * Sends CI/CD failure logs + code context to Claude and writes a
 * structured JSON fix plan to --output.
 *
 * Works with ANY pipeline — Claude reads the actual step names from
 * the logs rather than assuming a fixed set of steps.
 */

import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { parseArgs } from "util";

const { values: args } = parseArgs({
  options: {
    logs:    { type: "string" },
    context: { type: "string" },
    commits: { type: "string" },
    changed: { type: "string" },
    package: { type: "string" },
    output:  { type: "string" },
  },
});

function read(path, fallback = "") {
  if (!path || !existsSync(path)) return fallback;
  return readFileSync(path, "utf8").trim();
}

const failureLogs   = read(args.logs,    "(no logs)");
const codeContext   = read(args.context, "(no code)");
const recentCommits = read(args.commits, "(no commits)");
const changedFiles  = read(args.changed, "(no changed files)");
const packageJson   = read(args.package, "{}");

// ── System prompt — fully generic, no hardcoded pipeline steps ───────────────
const SYSTEM = `You are a senior DevOps engineer and software developer analyzing a GitHub Actions CI/CD pipeline failure.

You work with ANY tech stack and ANY pipeline structure. Do NOT assume specific step names — read the actual logs to determine what steps exist and which one failed.

Common step types you may encounter (non-exhaustive):
- Dependency install: npm ci, pnpm install, yarn install, pip install, bundle install, go mod download
- Linting: ESLint, Prettier, Pylint, RuboCop, golangci-lint
- Testing: Jest, Mocha, pytest, RSpec, go test, JUnit, Cypress, Playwright
- Building: npm run build, tsc, webpack, vite, gradle, maven, cargo build, docker build
- Security scanning: Trivy, Snyk, OWASP, npm audit
- Deployment: SSH, Docker push, Kubernetes, AWS ECS, Heroku, Vercel, Netlify
- Any other step present in the logs

Your task:
1. Read the logs carefully — identify EXACTLY which step failed and what the error message says
2. Suggest the SMALLEST possible fix — one targeted change only
3. Rate your confidence honestly

RESPONSE FORMAT: Valid JSON only. No markdown fences. No text before or after the JSON.

Schema (all fields required — use null for inapplicable optional string fields):
{
  "rootCause": "Specific explanation — which step, which file, which line, which error message",
  "failedStep": "The actual name of the step that failed, exactly as shown in the logs",
  "confidence": "high | medium | low",
  "fixSummary": "One sentence: what the fix does",
  "fixFile": "relative/path/to/file or null",
  "fixOriginal": "VERBATIM substring from the file content shown to you, or null",
  "fixReplacement": "Replacement string, or null",
  "fixType": "code | config | dependency | env | security | manual",
  "prTitle": "fix: concise PR title under 72 chars (conventional commit style)",
  "prBody": "Full markdown PR body: ## Problem, ## Root Cause, ## Fix Applied, ## How to verify",
  "manualSteps": ["Step 1", "Step 2"]
}

RULES:
- failedStep must come from the actual logs — never invent a step name
- fixOriginal MUST be a verbatim substring from the file content shown to you — never invent it
- Security CVE (Trivy, Snyk, npm audit): fixType="security", fixFile=null, explain upgrade in manualSteps
- Missing secret/env var: fixType="env", no code change, explain in manualSteps
- Transient errors (network timeout, rate limit): confidence="low", fixType="manual"
- Cannot identify a code fix: fixType="manual", clear human steps, no code change
- Never suggest changes to files not shown to you
- Keep fixOriginal and fixReplacement as the smallest possible diff`;

const USER = `## GitHub Actions failure report

### Failure logs (last 50 KB):
\`\`\`
${failureLogs.slice(0, 40000)}
\`\`\`

### Files changed in the failing commit:
\`\`\`
${changedFiles}
\`\`\`

### Content of changed files:
\`\`\`
${codeContext.slice(0, 15000)}
\`\`\`

### Recent git log:
\`\`\`
${recentCommits}
\`\`\`

### package.json (if present):
\`\`\`json
${packageJson.slice(0, 3000)}
\`\`\`

Respond with the JSON fix plan only.`;

// ── Call Claude ───────────────────────────────────────────────────────────────
console.log("AutoHealer: calling Claude claude-opus-4-5...");

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

let analysis;
try {
  const msg = await client.messages.create({
    model: "claude-opus-4-5",
    max_tokens: 2048,
    system: SYSTEM,
    messages: [{ role: "user", content: USER }],
  });

  const raw = msg.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");

  const cleaned = raw
    .replace(/^```(?:json)?\s*/m, "")
    .replace(/\s*```$/m, "")
    .trim();

  analysis = JSON.parse(cleaned);
  console.log("Claude response parsed successfully.");

} catch (err) {
  console.error("Claude API error:", err.message);
  analysis = {
    rootCause: "Auto-healer could not determine root cause. Manual review required.",
    failedStep: "unknown",
    confidence: "low",
    fixSummary: "Manual review needed",
    fixFile: null,
    fixOriginal: null,
    fixReplacement: null,
    fixType: "manual",
    prTitle: "fix: pipeline failure — manual review needed",
    prBody: "## Pipeline failure\n\nThe auto-healer could not analyse this failure automatically.\n\nPlease review the failed run logs directly.",
    manualSteps: [
      "Open the failed GitHub Actions run",
      "Read the logs to identify the failing step",
      "Fix the issue locally and push a new commit",
    ],
  };
}

const required = ["rootCause", "failedStep", "confidence", "fixSummary", "fixType", "prTitle", "prBody"];
for (const f of required) {
  if (!analysis[f]) analysis[f] = "unknown";
}
if (!Array.isArray(analysis.manualSteps)) analysis.manualSteps = [];

writeFileSync(args.output, JSON.stringify(analysis, null, 2), "utf8");

console.log("\n── Analysis ─────────────────────────────────────");
console.log(`Root cause  : ${analysis.rootCause}`);
console.log(`Failed step : ${analysis.failedStep}`);
console.log(`Confidence  : ${analysis.confidence}`);
console.log(`Fix type    : ${analysis.fixType}`);
console.log(`Fix file    : ${analysis.fixFile || "(none)"}`);
