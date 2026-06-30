# 00 — Cross-process follow wake in log reader

`follow` in `v2/src/log-stream.ts` blocks on a fixed 100ms poll after replay.
Replace that with cross-process wake on shared-storage append so a detached
`openLogReader` process receives new records for one `runId` without polling the
file on an interval. Closes the deferred cross-process wake item from structured
log stream planning.

## Prerequisites

- `follow` / `tail` replay and `AbortSignal` contracts exist in `log-stream.ts` with injectable storage path.
- Daemon IPC tail is backed by `logReader.follow` (consumer of this wake; wire proof in 01).

## Decisions

- Wake on append to shared storage, not in-process-only callbacks between sink and reader handles — rules out treating existing in-process `log-stream.test.ts` follow coverage as sufficient for detached consumers.
- Production `follow` blocking after replay is event-driven on shared-storage append, not fixed-period polling — rules out leaving the 100ms `setTimeout` loop or any interval poll as the notification path.
- Wake signals storage-artifact change only; `runId` filtering stays reader-side via existing `tail()` / replay walk — rules out per-run OS notification channels in this slice.
- `follow` replay-from-seq-1 then block-for-append contract unchanged — rules out snapshot-only tail or cursor/offset API changes.
- `AbortSignal` abort still ends `follow` without error — rules out changing shutdown semantics.
- Single `runId` per `follow` call — rules out multiplexed cross-run subscriptions in this slice.
- Cross-process proof uses detached reader plus separate-process writer on shared injectable storage — rules out requiring daemon-as-writer in this subspec (01 carries IPC wire proof).
- Sandbox proof assumes one writer per `runId` at a time — rules out concurrent multi-writer ordering claims in the cross-process test.
- Agent-runnable tests inject a wake-wait seam so assertions stay deterministic per `v2/docs/test-writing.md` — rules out load-sensitive sleeps in the default suite.
- Cross-process proof lives in `*.sandbox-unrunnable.test.ts` with a top comment — rules out agent-runnable subprocess coverage for the OS boundary.
- Deferred to first consumer: exact OS notification primitive (file watch, `kqueue`, etc.) — pin when implementation chooses storage layout; any non-event-driven fallback must be explicitly pinned there and must not be fixed-interval polling.
- Out of scope: log retention, rotation, medium change, `wait` RPC, CLI commands, generic pub/sub.

## Task checklist

- Replace fixed-interval `follow` blocking with shared-storage append wake in `log-stream.ts`.
- Expose or inject a test seam for the wait primitive so agent-runnable tests avoid wall-clock dependence.
- Add `log-stream.sandbox-unrunnable.test.ts`: detached child runs `follow` on a shared injectable path while a separate parent-process writer appends via `openLogSink`; child receives post-replay appends in `seq` order.
- Co-locate agent-runnable updates in `log-stream.test.ts` as needed for the seam.

## Acceptance criteria

- [x] `log-stream.test.ts` `"follow yields existing events from seq 1, then new appends in order"` stays green.
- [x] `log-stream.test.ts` `"follow stops without error when AbortSignal aborts"` stays green.
- [x] `log-stream.test.ts` `"tail and follow on unknown runId yield empty stream without error"` stays green.
- [x] `log-stream.test.ts` `"follow after sink close still replays persisted events"` stays green.
- [x] Agent-runnable `follow` tests coordinate live-append blocking through an injected wake-wait seam with no wall-clock dependence (`log-stream.test.ts`).
- [x] A detached reader on shared injectable storage receives records appended by a separate writer process for the same `runId` in ascending `seq` order without fixed-interval polling (`log-stream.sandbox-unrunnable.test.ts`; verify with `bun run test:integration:v2`).
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/v2-architecture.md` — Observability: cross-process `follow` wake settled — append-driven notification on shared storage so detached readers receive live appends after replay; daemon IPC tail inherits via `follow`; mechanism detail pinned when implementation chooses the OS primitive.
- `v2/spec/completed/2026-06-27T22-15-55Z-structured-log-stream/00-log-stream.md` — retract or update the cross-process `follow` wake deferral (L46–48) so the completed spec matches shipped behavior.
- Inline doc-comments on changed exported symbols per `v2/docs/documentation-standard.md`.
- `v2/docs/v1-behaviors.md`: no change — v2-only log reader behavior.
