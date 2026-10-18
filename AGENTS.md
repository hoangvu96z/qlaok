# Qlaok — rules for Codex and all coding agents

Read and follow [CODEGRAPH_WORKFLOW.md](docs/CODEGRAPH_WORKFLOW.md) before any coding task. Applies repository-wide: web, mobile, tests, scripts, and migrations.

## Mandatory CodeGraph workflow

- When `.codegraph/` exists, call `codegraph_explore` or `codegraph explore` before locating or reading source for reviews, debugging, fixes, features, or refactoring.
- Read indexed symbols/files with `codegraph_node` / `codegraph node`. Check callers and impact before changing shared contracts. Do not substitute grep/rg/find or bulk source reads for CodeGraph.
- If MCP is unavailable, use the CLI. For a stale index, run `codegraph status`, `codegraph sync`, then query again. Never delete or recreate the index yourself.
- If both MCP and CLI fail, report errors and limitations; stop source edits until CodeGraph works or the user authorizes a fallback. Unindexed docs/config/SQL may be read directly; stale files may be read directly after attempting sync.
- Every coding handoff must include CodeGraph queries, affected areas, checks run, and unverified items. This is a completion requirement.

## Business invariants

- Read README.md, ARCHITECTURE.md, and relevant domain docs before changing behavior.
- The server controls pricing, inventory, membership permissions, discounts, and financial state transitions. Fulfillment and payment are independent; completing service must not mark an order paid.
- Never report successful writes after DB failures or restore permissions from local fallback. Never weaken RLS to enable realtime.
- Web realtime uses the SSE broker; mobile uses Supabase JWT. Language changes must not reset drafts or recreate subscriptions.
- Never log or commit `.env`, tokens, service-role keys, or `.local-db` data. Never expose backend keys through `NEXT_PUBLIC_*` or `EXPO_PUBLIC_*`.
- Run relevant README checks; update docs when routes, schema, env, scripts, or behavior change. Do not commit, push, deploy, or migrate production unless requested; pushing main triggers deployment.
