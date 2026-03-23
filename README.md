# 🤖 AutoHealer — AI-Powered Self-Healing CI/CD

[![GitHub Marketplace](https://img.shields.io/badge/Marketplace-AutoHealer-orange?logo=github)](https://github.com/marketplace/actions/autohealer-ai-self-healing-cicd)

When your pipeline breaks, AutoHealer:

- Downloads the failure logs automatically
- Sends them to **Claude AI** for root cause analysis
- Opens a fix PR with a code patch applied
- **@mentions whoever broke it** with a plain English explanation
- Waits for `/approve-fix` or `/reject-fix` — **nothing merges without you**

**Works with any tech stack. Any pipeline. Any language.**

---

## Usage

Add this step to your existing pipeline **at the end**, after all your other steps:

```yaml
- name: AutoHealer
  if: failure()
  uses: YOUR_USERNAME/autohealer@v1
  with:
    anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
    gh_token: ${{ secrets.GH_PAT }}
```

The `if: failure()` means it only runs when something breaks — zero overhead on passing pipelines.

### With Slack notifications

```yaml
- name: AutoHealer
  if: failure()
  uses: YOUR_USERNAME/autohealer@v1
  with:
    anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
    gh_token: ${{ secrets.GH_PAT }}
    slack_token: ${{ secrets.SLACK_BOT_TOKEN }}
    slack_channel: ${{ secrets.SLACK_CHANNEL_ID }}
```

### Full example — drop into any pipeline

```yaml
name: CI

on:
  push:
    branches: ["*"]
  pull_request:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - run: npm ci
      - run: npm run lint
      - run: npm test
      - run: npm run build

      # ── Add AutoHealer at the end ──────────────────────────────
      - name: AutoHealer
        if: failure()
        uses: YOUR_USERNAME/autohealer@v1
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          gh_token: ${{ secrets.GH_PAT }}
```

---

## One-time setup (5 minutes)

### 1. Add two secrets

Go to your repo → **Settings → Secrets → Actions → New repository secret**

| Secret              | Value                                                                     |
| ------------------- | ------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY` | From [console.anthropic.com](https://console.anthropic.com/settings/keys) |
| `GH_PAT`            | Fine-grained PAT — see below                                              |

**Creating GH_PAT:**

```
GitHub → Settings → Developer settings → Fine-grained tokens → Generate new token

Resource owner    : your org or username
Repository access : Only this repository
Permissions:
  Contents        : Read and write
  Pull requests   : Read and write
  Workflows       : Read and write
```

### 2. Add the approval handler

Copy [`pr-approval.yml`](./pr-approval.yml) into your repo at `.github/workflows/pr-approval.yml`.

This handles `/approve-fix` and `/reject-fix` comments. It's a separate file because GitHub requires `issue_comment` triggered workflows to live in the calling repo — it can't be bundled inside the action itself.

### 3. Enable Actions permissions

Repo → **Settings → Actions → General → Workflow permissions**

- Select **"Read and write permissions"**
- Check **"Allow GitHub Actions to create and approve pull requests"**

If you're in a GitHub org, do the same at:
`github.com/YOUR-ORG → Settings → Actions → General`

---

## Inputs

| Input               | Required | Default | Description                     |
| ------------------- | -------- | ------- | ------------------------------- |
| `anthropic_api_key` | ✅       | —       | Anthropic API key for Claude AI |
| `gh_token`          | ✅       | —       | GitHub PAT (not GITHUB_TOKEN)   |
| `slack_token`       | ❌       | `""`    | Slack bot token                 |
| `slack_channel`     | ❌       | `""`    | Slack channel ID                |

## Outputs

| Output       | Description                                                           |
| ------------ | --------------------------------------------------------------------- |
| `pr_url`     | URL of the fix PR                                                     |
| `pr_number`  | PR number                                                             |
| `confidence` | `high` \| `medium` \| `low`                                           |
| `fix_type`   | `code` \| `config` \| `dependency` \| `env` \| `security` \| `manual` |

---

## How it works

```
Pipeline step fails
        ↓
AutoHealer step runs (if: failure())
        ↓
Downloads failure logs from GitHub API
Reads changed files from the failing commit
        ↓
Sends everything to Claude claude-opus-4-5 for analysis
        ↓
Claude returns: root cause + fix + confidence level
        ↓
Creates branch: autofix/<run-id>-<sha>
Applies code patch (if Claude found a specific fix)
Opens Pull Request
@mentions the person who triggered the failure
        ↓
They reply:
  /approve-fix  →  merged + pipeline re-runs
  /reject-fix   →  PR closed, fix manually
```

---

## Approval commands

Reply on the fix PR with:

| Command        | Effect                                                |
| -------------- | ----------------------------------------------------- |
| `/approve-fix` | Squash-merges the fix, pipeline re-runs automatically |
| `/reject-fix`  | Closes the PR, fix it yourself                        |

Only the person who triggered the failing pipeline, or a repo admin, can use these commands.

---

## What it fixes automatically

Works with any language and any CI tool. Common examples:

| Failure                             | Auto-fix?                    |
| ----------------------------------- | ---------------------------- |
| Syntax error / typo                 | ✅ Code patch applied        |
| Wrong import path                   | ✅ Code patch applied        |
| Missing dependency                  | ✅ Manifest patched          |
| Linting error                       | ✅ Code patch applied        |
| Security CVE (Trivy/Snyk/npm audit) | ❌ PR with upgrade steps     |
| Missing env var / secret            | ❌ PR explaining what to add |
| Transient / network error           | ❌ Low-confidence PR         |

---

## Why GH_PAT instead of GITHUB_TOKEN?

GitHub intentionally blocks `GITHUB_TOKEN`-triggered merges from firing other workflows — it's a safeguard against infinite loops. A PAT is treated as a human action, so the merge triggers your pipeline to re-run automatically after `/approve-fix`.

---

## License

MIT
