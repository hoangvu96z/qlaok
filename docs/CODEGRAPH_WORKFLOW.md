# Mandatory CodeGraph workflow

Updated: 2026-10-18. Shared by Codex (AGENTS.md) and Antigravity CLI (AGY: AGENTS.md, GEMINI.md). `.agents/rules/codegraph.md` uses `trigger: always_on` and inlines AGENTS.md and this workflow on every turn. Markdown provides agent instructions, not OS/CI enforcement or proof of tool execution.

## Every coding task

1. Identify the goal and read relevant docs. Check `.codegraph/` and run `codegraph status` from the repository root. Do not inspect `.env` to discover code.
2. **Before locating or reading source**, call `codegraph_explore` for the relevant area or symbols. Query separate subsystems as needed; a generic query does not justify reading the entire repository.
3. Use `codegraph_node` for additional symbol/file detail. Returned source with line numbers is already readable context; do not reread it with cat/rg.
4. Before changing APIs, shared types, auth, pricing, DB/RPC, or realtime, inspect callers and impact across relevant web/mobile/tests. Cross-file resolution is best effort; empty results do not prove code is unused or untested.
5. Make scoped edits. Check the index afterward; sync and query again if stale. Compilers and tests remain necessary to verify behavior.
6. Run relevant checks. Update README, architecture, env examples, or notes when contracts change. Provide concise handoff evidence.

## MCP and CLI equivalents

| Purpose | MCP | CLI verified in this repository |
| --- | --- | --- |
| Understand an area/flow | `codegraph_explore` | `codegraph explore "dbCreateOrder quoteOrderPricing"` |
| Read a file/symbol | `codegraph_node` | `codegraph node src/lib/mpos-store.ts` |
| Locate a symbol | `codegraph_search` | `codegraph query requireShopPermission` |
| Inspect callers | `codegraph_callers` | `codegraph callers requireShopPermission` |
| Check/update index | CLI | `codegraph status`, `codegraph sync` |
| Find potentially affected tests | CLI | `codegraph affected src/lib/mpos-store.ts` |

Use only commands supported by the installed `codegraph --help`. Run the CLI from the repository root, including mobile tasks. Set MCP `projectPath` when the default workspace differs.

## Limited exceptions

- Unindexed Markdown, JSON/config, SQL, and assets may be read with file tools/rg after querying CodeGraph for related source. Documentation-only tasks need no unrelated symbol queries.
- For stale-file warnings, try sync first. If still stale, read only that file directly and report the limitation; do not use this exception for bulk reads.
- If MCP is unavailable, use the CLI. If both fail, preserve the errors and continue independent docs work where possible; stop source edits until recovery or explicit user authorization for fallback.
- If another checkout has no `.codegraph/`, do not initialize it yourself. Report this; proceed with code only after the user chooses indexing or authorizes fallback.
- Do not upgrade CodeGraph, change global configuration, or delete the index database for a business task.

## Handoff evidence

```text
CodeGraph: explore "<symbols/area>"; node/callers "<target>" as needed.
Impact: <relevant API/core/UI/mobile/schema/tests>.
Checks: <actual commands and results>; not run: <reason>.
Docs: <updated files or unchanged contracts>.
```

## Review baseline: 2026-10-18

The review used explore for architecture/i18n/realtime/auth, node for types, plans, DB, mPOS, health, and admin credentials, plus CLI status/files/help. Status reported synchronized content with an index built by an older engine. Graph results are not exhaustive dependency proof. Do not hardcode node/edge counts in architecture docs; they vary with engine and code.

## Codex delegating to Antigravity CLI

AGY means the actual **Antigravity CLI**, not a renamed Codex agent. Codex invokes the `agy` binary, supplies scoped tasks, and requires AGENTS.md and this workflow. AGY uses CodeGraph CLI from the repository root when MCP is unavailable. Check the installed `agy --help` before choosing flags. Never use a flag that bypasses all permissions. Codex reviews diffs and independently reruns relevant checks before handoff; AGY's pass claims alone are insufficient evidence.

For coding tasks, Codex must launch AGY through `npm run agy -- --task-file <path> --model <model> --effort <level> --mode accept-edits`. The runner consumes `--output-format stream-json`, emits tool/check activity as it arrives, records a redacted JSONL log under ignored `.agy-runs/`, and reports the working-tree file delta at completion. Resume an exact conversation with `--conversation <id>`; use `--continue` only when the intended conversation is AGY's most recent one. The runner's `SUCCESS` means the CLI returned a successful terminal event and exit code; it does not certify the code or tests. Review the changed files and independently run the relevant checks before reporting completion. See [AGY_RUNNER.md](AGY_RUNNER.md) for invocation, log schema, privacy limits, and troubleshooting.
