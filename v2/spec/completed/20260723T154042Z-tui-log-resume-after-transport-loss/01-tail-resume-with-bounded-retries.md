# 01 - Log tail re-opens after transport loss until exhaustion

## Problem

`runTuiLogFollow` consumes one tail stream. A mid-stream `RpcConnectionError` renders
`daemon_error` once and returns 1 — the operator loses the tail on any daemon turnover
even though another live daemon owns the run.

## Decisions

- Mid-stream `RpcConnectionError` enters a resume loop: re-resolve, re-open, keep appending to the same session; rules out treating the first disconnect as terminal.
- Each attempt re-runs discovery plus `resolveOwningSocket` with the same query set and live-owner preference as the initial open; rules out reconnecting to the dead socket.
- Resume passes `afterSeq` = highest `seq` already appended to the session; rules out re-emitting delivered records.
- The attempt counter resets on a successful re-open; rules out a session-lifetime cap that ends a long tail after N total turnovers.
- Retry bound and per-attempt delay are injectable on `RunTuiLogFollowDeps`; defaults are 5 attempts with delay doubling from 100 ms, capped at 2 s. Injection rules out real sleeps in tests.
- Exhaustion shows `{ kind: "rpc-error", code: "tail_resume_exhausted" }` on the open session and returns 1; rules out reusing `daemon_error`, which now means nothing to the operator that a retry did not already try to fix.
- Failure of the *initial* open keeps the current single-shot `unavailable` + exit 1; rules out retrying a daemon that was never reachable.
- Operator quit during a retry wait ends the session at exit 0; rules out reporting exhaustion for an operator-initiated stop.
- Non-`RpcConnectionError` consume errors still propagate unchanged.

## Acceptance criteria

- [x] After a mid-stream transport loss the tail re-opens against a currently-live socket and continues appending without operator action; a test in `v2/src/tui/tui-log-follow-entry.test.tsx` fails against the current single-shot path.
- [x] Resume requests `afterSeq` equal to the last appended record's `seq`, and no record already shown is shown twice; asserted in `v2/src/tui/tui-log-follow-entry.test.tsx`.
- [x] Retries are bounded and exhaust: with every re-open failing, the loop stops after the configured attempt limit; inverting the retry-bound guard fails a test in `v2/src/tui/tui-log-follow-entry.test.tsx` (retries run past the limit).
- [x] On exhaustion `runTuiLogFollow` returns non-zero and `tail_resume_exhausted` appears in rendered ink output, asserted through the ink-capture render seam rather than view-host state.
- [x] Operator quit during a retry wait returns 0 and renders no `tail_resume_exhausted`; inverting the quit guard fails that test.
- [x] Existing `v2/src/tui/tui-log-follow-entry.test.tsx` unavailable-daemon and unexpected-consume-error tests stay green (initial-open and non-transport paths unchanged).
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe — `jarvis tui log` resumes across daemon turnover without duplicate records and without operator action.
- `v2/docs/write-behavior.md` — resume cursor use, retry bound/backoff defaults, and `tail_resume_exhausted` exit behavior for `jarvis tui log`.
- `v2/docs/v1-behaviors.md` — record `jarvis tui log` resume across transport loss (replacing single-shot `daemon_error`).
