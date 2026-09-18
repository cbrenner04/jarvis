# 00 — Workflow `finally` writes the settled marker

## Problem

The durable per-invocation settled marker (`writeWorkflowInvocationSettledMarker`, `v2/src/persistence/state-store.ts`) has no writer. The owning daemon must write it when the workflow promise ends.

## Decisions

- Write in the workflow promise `.finally` in `v2/src/daemon/daemon-workflow-admission-handlers.ts`, beside `settleStagesForEntryRun`, keyed by `entryRunId`; not in the `.then`/`.catch` arms and not from row-status rollup — only the `finally` runs after the publication tail ends.
- Cause resolution order: `killed` when any workflow run's id is in `killedWorkflowRuns` (computed in the same `finally`, from `activeRuns` entries with `pendingKill: true`, before that same `finally` deletes those `activeRuns` entries — read-then-delete ordering matters, so a run killed via `run kill` still resolves `killed` even though its `activeRuns` entry is gone by the time later code in the `finally` runs); else `failed` when `.catch` fired, the result kind is not `complete`, or a fired run timeout aborted the dispatch (a timeout aborts the same way `run kill` does but never sets `pendingKill`, so it is not mistaken for `killed`); else `completed`. Kill wins over failed because an aborted workflow also rejects into `.catch`.
- No marker when `entryRunId` is undefined (admission failed before any run row existed).
- Best-effort like stage settlement: a throwing store write is logged, never rethrown — the `finally` can outlive the store at shutdown.
- Crash gap: an invocation orphaned by a daemon crash before its workflow `finally` runs gets no marker — there is no other writer. Daemon-start recovery does not write markers either; it only settles durable rows. A crash-orphaned invocation stays markerless until (if ever) something rewrites it.

## Acceptance criteria

- [ ] A new test in `v2/src/daemon/daemon-workflow-admission-handlers.test.ts` drives completed, failed (non-`complete` result and thrown error), timed-out, and killed workflow settlements and asserts `readWorkflowInvocationSettledMarker(entryRunId)` returns the matching cause (`failed` for the timeout case, `killed` for the killed case); it fails against the pre-fix code.
- [ ] A test wraps the git/gh subprocess runner with `createHoldableAsyncFn` (`v2/src/testing/holdable-async-subprocess-runner.ts`, the same seam `daemon-ipc-responsiveness.sandbox-unrunnable.test.ts` uses) to hold the workflow's publication step open, asserts `readWorkflowInvocationSettledMarker(entryRunId)` is `null` while `whenPending()` is unresolved, then calls `release()` and asserts the marker appears with cause `completed`.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md`: the owning daemon writes the invocation settled marker (cause, time) in the workflow `finally`, after the publication tail; a timed-out workflow settles `failed`, not `killed`; a daemon crash before `finally` runs, or daemon-start recovery, leaves the invocation markerless.
