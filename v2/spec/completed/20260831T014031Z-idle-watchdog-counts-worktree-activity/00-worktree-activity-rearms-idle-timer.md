# Re-arm the idle timer on worktree file writes via an injectable watcher

## Problem

The idle-output watchdog (`armIdleTimer` in `shared/invocation/agents.ts`) re-arms only on agent **stdout** bytes. An agent that is productively working but silent — cursor or codex running a long tool (shell, search, a large edit) that streams nothing, or writing files without emitting stream-json frames — is invisible to the watchdog and gets false-killed on `idle_output_timeout` even though it is actively changing the worktree. Raising `idleOutputTimeoutMs` only widens tolerance; "productive" is still proxied by stdout chatter, which cursor/codex are not during tool phases. Observed 2026-08-30 (`document-pipeline-execution-architecture`, run `7421843a`): cursor wrote and **committed** a correct 224-line doc, then was killed by `idle_output_timeout` on the silent edit phase.

## Surface

The idle-timer arming path in `shared/invocation/agents.ts` (`armIdleTimer` and the invocation options that already inject `spawn`/`setTimeout`/`clearTimeout`); co-located regressions in `shared/invocation/agents.test.ts` (or the existing invocation test file); operator/watchdog docs. No change to the stdout re-arm path, the `idleOutputMs` budget, the stall settlement shape, or callers that do not pass the new seam.

## Decision ledger

- Add worktree filesystem activity as a **second re-arm source** alongside stdout: a create/modify/delete under the invocation's `cwd` calls `armIdleTimer()`, so a silently-editing agent stays alive while it is changing files. Rules out proxying productivity by stdout alone.
- Introduce the watcher as an **injectable seam** (`watchWorktreeActivity?({ cwd, onActivity, signal })`, defaulting to a debounced `fs.watch` on `cwd`), mirroring the existing `spawn`/`setTimeout` seams, so tests drive activity deterministically without real `fs.watch` or real timers. Rules out an untestable hard-wired watcher (the determinism-guarded suite forbids real timers/fs waits).
- The default watcher is **debounced** and scoped to `cwd` only, and **ignores harness sidecar churn** — paths whose basename starts with `.jarvis-` or matches `verdict-*.md` do not re-arm — so sidecar writes cannot mask a genuinely hung agent. Rules out a global watch or one that never times out.
- Keep the stdout re-arm and the machine-wide `idleOutputMs` bound unchanged; filesystem activity is additive. The watcher is disposed on settle alongside the idle timer. Rules out leaking a watcher past invocation end.

## Task checklist

- Add the `watchWorktreeActivity` seam to the invocation options and thread a default debounced `fs.watch`-based watcher (cwd-scoped, sidecar-filtered) that calls `armIdleTimer` on qualifying activity.
- Dispose the watcher wherever the idle timer is cleared/settled.
- Add `agents.test.ts` regressions (see acceptance criteria) driving the injected watcher and injected timers.
- Update the watchdog docs.

## Acceptance criteria

- [x] An `agents.test.ts` test drives an invocation that emits no stdout, then fires the injected `watchWorktreeActivity` `onActivity` for a non-sidecar path under `cwd` before the injected idle budget elapses, and proves the idle timer is re-armed (the invocation does not settle `stall`); it fails against the pre-fix stdout-only watchdog.
- [x] An `agents.test.ts` test proves an invocation with no stdout and no filesystem activity still settles `stall` when the injected idle budget elapses (the watchdog still fires on a genuinely hung agent).
- [x] An `agents.test.ts` test proves `onActivity` for an ignored sidecar path (basename starting `.jarvis-`, or `verdict-*.md`) does NOT re-arm the timer — a sidecar-only stream still settles `stall`.
- [x] An `agents.test.ts` test proves the injected watcher is disposed when the invocation settles (its returned dispose/`signal` teardown is invoked), so no watcher leaks past invocation end.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/operator-runbook.md` — the `idle_output_timeout` / `role_stalled` sections note worktree file writes now count as activity, so a silent-but-editing agent is no longer false-killed; sidecar writes still do not.
- `v2/docs/write-behavior.md` — record the filesystem re-arm source, the cwd scope, the debounce, and the sidecar-ignore rule.
