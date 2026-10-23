# Supabase MCP

Qlaok provides a project-scoped connection to the official hosted Supabase MCP server for Codex and Antigravity:

- Codex: `.codex/config.toml`
- Antigravity CLI/IDE: `.agents/mcp_config.json`

Both point to the project's Supabase reference and set `read_only=true`. The server only exposes the `database`, `docs`, and `debugging` feature groups, and both clients block the `apply_migration` tool. The project reference is an identifier, not a credential. Authentication uses each client's OAuth flow; never put a Supabase access token, database password, or service-role key in either config file.

## Authenticate

Open this repository as a trusted project in Codex, then use **Settings → MCP Servers → Authenticate** for `supabase` (or run `codex mcp login supabase` from the project). Review the OAuth consent screen, complete authentication, then restart or refresh the MCP connection and verify it in `/mcp`.

In Antigravity, open the workspace MCP manager with `/mcp`, review and authenticate `supabase`, then reload the connection. Antigravity stores OAuth tokens outside the repository.

## Use and limits

Use this MCP when a task needs current schema, migration state, database inspection, logs, advisors, or Supabase documentation. Keep queries limited to the task and avoid exposing customer data. `read_only=true` makes SQL inspection read-only, and `apply_migration` is blocked in both client configs. The hosted MCP OAuth flow may request broad Supabase scopes; inspect and approve those scopes in the consent screen. Make database changes through reviewed migration files and the established deployment workflow.

If the Supabase project changes, update the `project_ref` in both configs from the project's Supabase URL, then verify both JSON and TOML syntax. Do not copy the `.env` file or its credentials into these configs.

References: [Supabase MCP Server](https://supabase.com/docs/guides/ai-tools/mcp), [Codex MCP](https://developers.openai.com/codex/mcp), [Antigravity MCP](https://www.antigravity.google/docs/mcp).
