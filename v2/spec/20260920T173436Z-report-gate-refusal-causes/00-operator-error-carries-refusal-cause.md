# Operator error carries the gate-refusal cause and slot retry state

## Problem

`mapFromLoopFinished`'s `gate_invocation_refused` branch in `v2/src/daemon/run-operator-error.ts` returns one shape for every refusal: `resume`, retryable, message `Gate invocation refused: <command>`. The durable `gateRefusalRecoveryState` projection (cause, gate command, `slotRedriveCount`) already round-trips on the run row but never reaches the operator error, so `list`/`wait` cannot distinguish a `ceiling_headroom` refusal from a slot-contention lane that consumed its automatic re-drives.

## Behavior

A composed `gate_invocation_refused` operator error carries the durable `gateRefusalCause`; for `slot_contention` it also carries `slotRedriveCount` and `slotRedriveBound`. For `slot_contention` the operator error `message` also carries a cause-specific remedy: bounded-exhaustion diagnosis at the bound, non-committal automatic-re-drive copy below it. `ceiling_headroom` and `legacy_unknown` keep the ordinary resume remedy and the existing message shape.

## Decisions

- Read cause/count from `run.gateRefusalRecoveryState`, not the terminal `loop_finished` event; the log tail is not the row's state of record.
- Input threading: `mapFromLoopFinished` and `resolveFailedBlockedAttemptPrecedence` take the run's `gateRefusalRecoveryState`, passed from every call site in `composeRunOperatorErrorFromState` (log path, `fromCause`, and tail); resume-admission callers already pass `{ ...run, attempts }`, which retains the field, so they need no change; rules out a log-only projection.
- Import `MAX_SLOT_REDRIVES` from `v2/src/daemon/daemon-slot-redrive.ts` as the bound's single source; rules out re-declaring the number.
- Keep `reason: "gate_invocation_refused"` and `nextAction: "resume"` for every cause, including bound exhaustion — those lanes stay operator-resumable per `operator-runbook.md`; rules out new closed reasons or demoting exhausted lanes to `stop`.
- Cause-specific remedy lands in `message`, the only recovery-bearing field that reaches `list`/`wait`; `RUN_OPERATOR_ERROR_RECOVERY` is read only by `terminalResumeRefusalMessage`, which returns `undefined` when `nextAction` is `resume`, so a cause-aware record entry would be operator-unreachable. The record's `gate_invocation_refused` entry stays the ceiling-headroom text.
- Below-bound copy stays non-committal ("automatic re-drive may be pending", with `jarvis run resume` as the manual path): `daemon-slot-redrive.ts` drops a lane on owner-probe failure, non-redrivable row, retained-work problem, or refused re-drive, recorded only in the run log and not in `gateRefusalRecoveryState`; rules out promising a guaranteed re-drive.
- `message` keeps its log-sourced `Gate invocation refused: <event.gateCommand>` prefix for every cause; durable `gateCommand` is not used, so the existing message stays unchanged when no log event is present. Slot-contention remedy text is appended to that prefix.
- `slotRedriveCount`/`slotRedriveBound` are projected only for `slot_contention`; `legacy_unknown` carries the cause alone since no durable count exists.
- `gateRefusalRecoveryStateCorrupt` is not projected: an unparseable column already reads as `legacy_unknown` with the ordinary resume path, and no operator action differs; rules out a separate corrupt field.

## Acceptance criteria

- [ ] `v2/src/daemon/run-operator-error.test.ts` proves a `ceiling_headroom` refusal and a `slot_contention` refusal at the bound compose distinct `gateRefusalCause` values, and that the slot refusal carries its consumed `slotRedriveCount` and `slotRedriveBound`; the test fails against the pre-fix undifferentiated operator error.
- [ ] A test through `composeRunOperatorError` proves the operator error `message` for a `ceiling_headroom` or `legacy_unknown` refusal keeps the ordinary resume-remedy shape, a `slot_contention` refusal at the bound carries distinct bounded-exhaustion text, and one below the bound carries non-committal automatic-re-drive text that still names `jarvis run resume`; it fails against the pre-fix single message.
- [ ] A test proves a below-bound slot refusal whose lane was dropped from the coordinator (no durable evidence of the drop) composes the same non-committal message and still `nextAction: "resume"`.
- [ ] A test proves a row with an unparseable `gateRefusalRecoveryState` column composes as `legacy_unknown` with no slot count or bound.
- [ ] Daemon `list` and `wait` tests prove both refusal shapes reach the operator error projection with their cause, remedy `message`, and, for slot contention, count and bound.
- [ ] Existing `v2/src/daemon/run-operator-error.test.ts` and `v2/src/daemon/daemon-wait-run-completion.test.ts` cases stay green (non-gate operator errors unchanged).
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — the `gate_invocation_refused` operator-error projection: cause, slot count, bound, and cause-specific `message` remedy.
- `v2/docs/v1-behaviors.md` — record the differentiated v2 operator-visible refusal cause and bounded retry evidence.
