---
name: tui-log-resume-after-transport-loss
---

# `jarvis tui log` resumes after transport loss without duplicate records

## Problem

On IPC transport loss the log tail converts `connection closed` into `RpcConnectionError`, renders `daemon_error` once, and exits non-zero. There is no retry, no stream re-open, and `stream-open` carries only `{ runId }`, so turnover cannot resume after the last observed record.

## Decisions

- After transport loss, re-open the tail stream against a currently-live socket with bounded backoff until success or exhaustion; rules out treating the first disconnect as terminal.
- `stream-open` payload adds `afterSeq: number` — last observed `PersistedRecord.seq`, `0` for full replay; rules out ad-hoc cursor types.
- `createTailStreamHandler` / `streamRunLogRecords` skip records with `seq <= afterSeq` before follow; rules out client-only dedupe.
- Each reconnect re-runs cross-daemon owner resolution (same query set and preference as initial open); rules out pinning to the dead socket.
- Records already emitted to the operator are not re-emitted on resume; rules out full replay on reconnect.
- Retry exhaustion surfaces `tail_resume_exhausted` in operator feedback and exits non-zero; rules out a silent stop after transient failures are retried.
- The current single-shot `daemon_error` / exit `1` is the exhausted case, not the first failure; rules out showing terminal failure on the first disconnect.

## Acceptance criteria

- [ ] The log tail survives transport loss: the stream re-opens against a live socket and continues without operator action, and no record already emitted is emitted twice; a test in `v2/src/tui/tui-log-follow-entry.test.tsx` fails against the current single-shot path.
- [ ] `stream-open` with `afterSeq` skips replayed records server-side; a test in `v2/src/daemon/daemon-tail-stream.test.ts` fails against the current full-replay path.
- [ ] Bounded retries run before exhaustion; inverting the retry guard fails a test in `v2/src/tui/tui-log-follow-entry.test.tsx`.
- [ ] On retry exhaustion the command surfaces `tail_resume_exhausted`, renders it in ink output, and exits non-zero.
- [ ] Coverage asserts rendered ink output, not just view-model state.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe — `jarvis tui log` resumes across daemon turnover without duplicate records.
- `v2/docs/write-behavior.md` — resume cursor and retry-exhaustion behavior for `jarvis tui log`.
- `v2/docs/v1-behaviors.md` — record `jarvis tui log` resume across transport loss.

## Prerequisites

- `jarvis tui log` resolves runs across live keyed daemons.
