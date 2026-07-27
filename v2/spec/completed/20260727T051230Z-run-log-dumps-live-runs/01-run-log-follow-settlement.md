# 01 - `--follow` exits when a live run settles

## Problem

After [00](./00-run-log-snapshot-default.md), `--follow` still tails until the daemon closes the
stream or the client disconnects — it never terminates on its own when the run it is following
finishes. `FileLogStream.follow` (`v2/src/persistence/log-stream.ts`) polls the log file forever and
never reads run status; `streamRunLogRecords` (`v2/src/daemon/daemon.ts`) reads `run.status` once,
before entering the follow loop, and never again. An operator running `run log <id> --follow` on a
run that completes has no way to know it settled short of Ctrl-C and a separate `run list`/`run wait`.

## Decisions

- `streamRunLogRecords` re-reads run status from `deps.stateStore` on each `follow()` poll tick
  (once per yielded batch, including empty ticks) instead of once up front; when the status is
  terminal (`isTerminalRunStatus`, `v2/src/persistence/state-store.ts`), it stops consuming
  `follow()` and returns (closing the stream) after draining any records already yielded for that
  tick — rules out a fixed-delay guess or a second poller racing the log poller.
- A run that goes terminal between the replay read and the first follow tick is handled by the same
  check: the next status re-read (immediately after replay, before or during the first `follow()`
  iteration) observes the terminal status and closes after that iteration's records are sent, so no
  record written before termination is dropped.
- `follow()` itself (`v2/src/persistence/log-stream.ts`) is unchanged — it has no run-status
  awareness and keeps polling until its `AbortSignal` fires; termination is driven by
  `streamRunLogRecords` aborting/stopping consumption, not by a change to the reader.
- This applies only when `follow: true`; snapshot mode ([00](./00-run-log-snapshot-default.md))
  already closes after replay regardless of run status.

## Task checklist

- [ ] Re-read run status from `deps.stateStore` inside `streamRunLogRecords`'s follow-consumption
      loop and stop consuming once it is terminal.
- [ ] Ensure records already available in the same tick that flips the run terminal are sent before
      the stream closes (no drop of the final batch).
- [ ] Update the docs below.

## Acceptance criteria

- [x] `v2/src/daemon/daemon-tail-stream.test.ts` regression test `follow closes once the run settles`
      drives `streamRunLogRecords` with a fake `LogReader.follow()` that yields a record, then a fake
      `StateStore` whose `loadRun` flips the run to a terminal status after that yield, and asserts
      the call returns (closing the stream) without waiting for `follow()`'s iterator to end on its
      own; it fails against the pre-01 code, which never re-reads status and keeps consuming
      `follow()` until the signal aborts.
- [x] A second case in the same suite covers a run that is already terminal by the first status
      re-read (settles between replay and the first follow tick): the stream closes without yielding
      an extra follow-loop record beyond what replay already sent.
- [x] `v2/src/commands/run.test.ts` test `run log --follow exits when the daemon closes the stream`
      drives `run log <id> --follow` with a queued `stream-end` frame after the record frames and
      asserts exit `0`; confirms the CLI's existing await-until-`stream-end` loop needs no change
      (behavior-preserving; the closing signal now originates from settlement instead of only client
      disconnect).
- [x] Snapshot-mode (`00`) behavior and its tests are unaffected: `run.test.ts` and
      `daemon-tail-stream.test.ts` tests from `00` stay green.

## Documentation updates

- `v2/docs/write-behavior.md` — extend the `run log` `--follow` description: tails until the daemon
  closes the stream, which now happens automatically once the followed run settles (not only on
  client disconnect).
- `v2/docs/daemon-host.md` — document the follow-completion mechanism: per-tick run-status re-read,
  what "settle" means (`isTerminalRunStatus`), and the drain-before-close guarantee for the final
  batch.
- `v2/docs/v1-behaviors.md` — record the v2 behavior addition: `run log --follow` exits on run
  settlement instead of running until Ctrl-C.
- `v2/docs/operator-runbook.md` — update the `run log` gotcha bullet from `00` to note `--follow` now
  exits on its own once the run finishes.
