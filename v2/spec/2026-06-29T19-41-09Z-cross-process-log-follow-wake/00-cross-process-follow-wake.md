# 00 — Cross-process follow wake in log reader

`follow` in `v2/src/log-stream.ts` blocks on a fixed 100ms poll after replay.
Replace that with cross-process wake on shared-storage append so a detached
`openLogReader` process receives new records for one `runId` without polling the
file on an interval. Closes the deferred cross-process wake item from structured
log stream planning.

## Decisions

- Wake on append to shared storage, not in-process-only callbacks between sink and reader handles — rules out treating existing in-process `log-stream.test.ts` follow coverage as sufficient for detached consumers.
- `follow` replay-from-seq-1 then block-for-append contract unchanged — rules out snapshot-only tail or cursor/offset API changes.
- `AbortSignal` abort still ends `follow` without error — rules out changing shutdown semantics.
- Single `runId` per `follow` call; wake is scoped to that run's new records — rules out multiplexed cross-run subscriptions in this slice.
- Production wake must not depend on a fixed-interval poll loop — rules out leaving the current 100ms `setTimeout` as the cross-process notification path.
- Agent-runnable tests inject a wake-wait seam (or equivalent DI) so assertions stay deterministic per `v2/docs/test-writing.md` — rules out load-sensitive sleeps in the default suite.
- Cross-process proof lives in `*.sandbox-unrunnable.test.ts` with a top comment — rules out agent-runnable subprocess coverage for the OS boundary.
- Deferred to first consumer: exact OS notification primitive (file watch, poll interval fallback, etc.) — pin when implementation chooses storage layout.
- Out of scope: log retention, rotation, medium change, `wait` RPC, CLI commands, generic pub/sub.

## Task checklist

- Replace fixed-interval `follow` blocking with shared-storage append wake in `log-stream.ts`.
- Expose or inject a test seam for the wait primitive so agent-runnable tests avoid wall-clock dependence.
- Add `log-stream.sandbox-unrunnable.test.ts`: detached child runs `follow` on a shared injectable path while the parent appends via `openLogSink`; child receives post-replay appends in `seq` order.
- Co-locate agent-runnable updates in `log-stream.test.ts` as needed for the seam.

## Acceptance criteria

- [ ] `follow(runId)` still yields persisted events from `seq` 1 in order, then yields events appended after subscribe, in order (test).
- [ ] `follow` stops without error when its `AbortSignal` aborts (test).
- [ ] `tail` and `follow` on an unknown `runId` still yield an empty stream without error (test).
- [ ] `follow` after the writer `close()` still replays persisted events (test).
- [ ] A detached child process running `follow` on shared storage receives records appended by a separate parent-process writer for the same `runId` in `seq` order without relying on fixed-interval polling (`log-stream.sandbox-unrunnable.test.ts`).
- [ ] `log-stream.test.ts` stays green (replay, abort, unknown run, post-close replay contracts preserved).
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v2/docs/v2-architecture.md` — Observability: record that cross-process `follow` wake is settled (shared-storage append notification; detached readers receive live appends; IPC tail inherits via `follow`).
- Inline doc-comments on changed exported symbols per `v2/docs/documentation-standard.md`.
- `v2/docs/v1-behaviors.md`: no change — v2-only log reader behavior.
