# GitHub Actions workflow in Codex

Qlaok's repository is `hoangvu96z/qlaok`. Pushes to `main` can deploy production, so agents must verify the exact commit after an authorized push and must not trigger workflow reruns unless the user asks.

## Project configuration

`.codex/config.toml` enables GitHub's remote MCP server for this trusted project and reads its bearer token from `GITHUB_PAT_TOKEN`. The hosted GitHub MCP endpoint requires a Personal Access Token; `codex mcp login github` fails because this endpoint does not support Dynamic Client Registration. Set the variable in the environment that launches Codex, with repository access and read-only Actions permission. Never put the token in this file, another repository file, `.env`, logs, or CI output.

```sh
codex mcp list
```

Codex Desktop, CLI, and IDE use the project-scoped server configuration. A GitHub connector already exposed by the host can be used directly without opening the Actions website. The MCP server's access follows the token's repository permissions.

## Required Actions verification

After pushing a commit:

1. Use the connected GitHub MCP tools to find the workflow run whose head SHA matches the pushed commit.
2. Wait until the run is completed. Do not treat a queued, in-progress, cancelled, or missing run as a pass.
3. If a job fails, inspect its status and logs, fix the cause, then push a new commit and verify that commit's run.
4. Report the exact commit, final run conclusion, and run URL. Claim a successful deploy only when the run's deploy job also completed successfully.

Use read-only GitHub operations for status checks. If the MCP server is disconnected or unavailable, use an available GitHub CLI or read-only API path and say which source was used; do not open the Actions website for routine checks. Never print or commit credentials.
