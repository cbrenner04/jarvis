# 03 - Define recovery semantics and recovery-oriented coverage

Phase 1 is not done when records exist; it is done when resume semantics are
concrete enough that later daemon work does not have to rediscover what
"durable" means. This slice defines the boundary-checkpoint recovery model,
idempotence rules, and tests that prove kill-resume equals crash-recovery at the
store boundary without inventing mid-step snapshots or structured log history.

## Decisions

- Recovery is defined at step boundaries only. An in-flight interrupted attempt
  is replayed from the last durable pre-step checkpoint.
- The run owns one concrete durable checkpoint such as the next step to execute
  or equivalent boundary marker; replay derives from that plus append-only
  attempt history.
- A completed boundary advances exactly once. Recording a finished attempt twice
  must not advance resume state twice.
- The model must distinguish "attempt recorded but checkpoint not advanced" from
  "boundary fully committed" so recovery reads know whether to replay or
  continue.
- Keep observability out of the contract. Structured logs, event streams, and
  daemon steering state remain Phase 2+ work unless needed for a concrete
  recovery invariant.

## Task Checklist

- Define the exact resume rules for completed, interrupted, and not-yet-started
  boundaries.
- Define the idempotence rules around finish and checkpoint advancement.
- Define recovery-oriented tests that exercise crash-like partial writes and
  exact-once boundary advancement.
- Update the v2 docs that describe persistence and recovery ownership.

## Acceptance criteria

- [ ] The subspec states that kill-resume and crash-recovery are the same at
      the Phase 1 state boundary: interrupted in-flight work replays from the
      last durable pre-step checkpoint rather than resuming mid-step.
- [ ] The subspec defines one concrete durable checkpoint model on the run and
      requires recovery reads to derive replay behavior from that checkpoint
      plus durable attempt history, not from scattered mutable in-progress
      fields.
- [ ] The subspec makes boundary idempotence explicit: persisting the same
      finished boundary twice cannot advance resume state twice or duplicate the
      durable terminal effect.
- [ ] The subspec requires coverage that distinguishes at least three cases:
      no attempt recorded yet, attempt recorded but checkpoint not advanced, and
      boundary fully committed.
- [ ] The subspec keeps mid-step snapshots, structured log/event history, human
      steering state, and daemon lifecycle concerns out of scope unless a
      concrete recovery read requires them.

## Documentation updates

- Update `v2/docs/v2-build-order.md` and `v2/docs/v2-architecture.md` so both
  documents say Phase 1 owns the boundary-checkpoint recovery contract and that
  later daemon work only triggers that recovery through another surface.
