# Carry an explicit gate-refusal cause

## Problem

`createIterationActiveGateTracker` calls the same `onRefused(command)` for both refusal reasons: insufficient `TEST_STEP_BUDGET_MS` headroom against `iterationCeilingMs`, and `acquireGateInvocationLease()` returning nothing because a lane already holds the only lease. Downstream, `awaitIteration` produces an undifferentiated `gate_invocation_refused` settlement and `finishGateInvocationRefused` settles it identically, so nothing after the refusal site can tell contention from ceiling exhaustion — the distinction the next subspec's checkpoint decision depends on.

## Decisions

- Classify at the refusal site: the tracker passes the cause it already knows to `onRefused`; rules out inferring cause later from timing, lease counts, or log text.
- Name the causes `slot_contention` and `ceiling_headroom`; rules out a boolean that cannot grow a third admission reason.
- Carry the cause on the `gate_invocation_refused` settlement, the `WriteLoopResult`, and the `loop_finished` log entry alongside the existing `gateCommand`; rules out dropping it at the settlement seam where the next subspec must read it.
- Leave ceiling-headroom settlement otherwise unchanged — same `runStatus`, `outcomeKind`, resumability, and lease semantics.

## Acceptance criteria

- [x] A write-loop regression test drives a slot-contention refusal and a ceiling-headroom refusal and asserts they surface distinct causes on the loop result; it fails against the pre-fix undifferentiated refusal.
- [x] A slot-refused run's `loop_finished` entry carries the refusal cause next to `gateCommand`.
- [x] Existing owned-lease and ceiling-headroom refusal tests in `v2/src/execution/write-loop.test.ts` stay green (refusal settlement otherwise unchanged).
- [x] `v2/docs/write-behavior.md` describes the two refusal causes and where each is decided.
- [x] `v2/docs/v1-behaviors.md` records that v2 gate refusal settlement now carries an explicit cause.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — refusal cause classification at the headroom check and lease acquisition.
- `v2/docs/v1-behaviors.md` — v2 refusal settlement carries an explicit cause.
