# Idle-output watchdog counts worktree filesystem activity, not just agent stdout

## Problem

The idle-output watchdog (`armIdleTimer` in `shared/invocation/agents.ts`) re-arms only on agent **stdout** bytes (`stdout.on("data") → armIdleTimer()`). An agent that is productively working but silent — cursor or codex running a long tool (shell command, search, big edit) that streams nothing between the tool's start and return, or writing files without emitting stream-json frames — is invisible to the watchdog and gets false-killed on `idle_output_timeout`. Raising `idleOutputTimeoutMs` (now 15 min) widens the tolerance but does not fix the root cause: "productive" is proxied by "chatty on stdout," which cursor/codex are not during tool phases. stderr does not re-arm either.

## Evidence (2026-08-30)

The `document-pipeline-execution-architecture` implement (run `7421843a`): codex fast-quota'd, escalated to cursor, cursor wrote a 224-line doc + cross-links and **committed** it (`352bfde`), then `idle_output_timeout` killed the step — under only light concurrency (one other plan running). The committed work was correct and complete; the kill was a false negative on a silent-but-productive edit phase. `retry: false`, so it did not even advance the agent order.

## Decisions

- Re-arm the idle timer on **worktree filesystem activity** (a create/modify/delete under the run's worktree, e.g. via a debounced `fs.watch`/mtime poll), in addition to stdout. A silently-editing agent then stays alive as long as it is changing files. Rules out proxying productivity by stdout chatter alone.
- Keep the existing stdout re-arm and the machine-wide `idleOutputTimeoutMs` budget; filesystem activity is an additional re-arm source, not a replacement. Rules out removing the stdout path or the configurable bound.
- Watch only the run's own worktree (scoped), debounced to avoid a busy loop; ignore harness sidecar churn (`.jarvis-*`, verdict files) so sidecar writes do not mask a genuinely hung agent. Rules out a global watch or one that never times out.

## Acceptance criteria

- [ ] A test drives an invocation that emits no stdout but writes a file under the worktree within the idle budget, and proves the idle timer re-arms (the invocation is not settled `stall`); it fails against the current stdout-only watchdog.
- [ ] A test proves an invocation with no stdout and no worktree file changes still settles `stall` at the idle budget (the watchdog still fires on a genuinely hung agent).
- [ ] A test proves writes to ignored sidecar paths (`.jarvis-*`, `verdict-*.md`) do NOT re-arm the timer.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass (shared/execution surface).

## Documentation updates

- `v2/docs/operator-runbook.md` — the `idle_output_timeout` / `role_stalled` sections note that worktree file writes now count as activity, so a silent-but-editing agent is no longer false-killed.
- `v2/docs/write-behavior.md` (or the idle-watchdog reference) — record the filesystem re-arm source and the sidecar-ignore scope.
