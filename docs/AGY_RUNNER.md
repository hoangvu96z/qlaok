# AGY event runner

Codex must use this repository runner when delegating coding work to Antigravity CLI. It consumes AGY `stream-json` events, prints activity as it arrives, and writes a local JSONL log. One process stream replaces repeated status queries.

## Start a task

Save a scoped prompt in an ignored local file, then run the command from the repository root:

```bash
mkdir -p .agy-runs/tasks
npm run agy -- \
  --task-file .agy-runs/tasks/catalog-bulk-actions.md \
  --model gemini-3.8-flash-high \
  --effort high \
  --mode accept-edits
```

Choose the model for the task: use Flash for small, tightly scoped work and Argon for difficult, cross-cutting, or security-sensitive work. Confirm model names with `agy models`. Use `--conversation <id>` to resume a specific conversation printed by the runner. Use `--continue` only when the intended conversation is AGY's most recent one; omit both flags for an independent task. `--mode plan` disables edit mode. Never use `--dangerously-skip-permissions`.

The runner prints tool starts and completions, detected file paths, recognized test/build/typecheck activity, quiet intervals, the final CLI status, token usage, and changed paths. A quiet interval means AGY emitted no event; it may be processing or waiting for input and does not prove a hang. Terminal stdin remains available for interactive CLI prompts.

## Logs and verification

Each run writes `.agy-runs/<run-id>.jsonl`. The directory is ignored by Git, and the default directory is restricted to the current user where filesystem permissions are supported. Log files use owner-only permissions when created. The directory can also hold local task prompt files. Records include model/effort/mode, conversation ID, event type and step state, tool name, a reduced command summary or file path, check outcome/counts when AGY exposes them, quiet intervals, token usage, and a before/after worktree path delta.

Logs omit full AGY responses and tool output. Credential-shaped values are redacted; `.env*`, `.local-db`, `.next`, and `node_modules` are excluded from file hashing. A `SUCCESS` status means only that the CLI emitted a successful terminal result and exited with code 0. A check is `unverified` when the stream does not expose a clear exit status or test counts. Activity events are not proof that a change or check succeeded: inspect the diff and independently rerun relevant checks. Existing dirty files are captured as the baseline, so the final delta highlights paths changed during the run.

Run `npm run test:agy-runner` to test event normalization, redaction, check summaries, and worktree delta handling without launching AGY.
