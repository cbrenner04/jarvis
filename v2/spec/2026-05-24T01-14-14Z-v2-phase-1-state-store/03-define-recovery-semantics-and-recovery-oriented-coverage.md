# 03 - Define recovery semantics and recovery-oriented coverage

Phase 1 is not done when records exist; it is done when resume semantics are
concrete enough that later daemon work does not have to rediscover what
"durable" means. This slice defines the boundary-checkpoint recovery model,
idempotence rules, and tests that prove kill-resume equals crash-recovery at the
store boundary without inventing mid-step snapshots or structured log history.

## Decisions

- Recovery is defined at step boundaries only. An interrupted in-flight attempt
  replays from the last durable pre-step checkpoint.
- The run owns one concrete durable checkpoint such as the next step to execute;
  replay derives from that plus append-only attempt history.
- A completed boundary advances exactly once. Retrying the same finished
  boundary write must not advance resume state twice.
- The model must distinguish "attempt recorded but checkpoint not advanced" from
  "boundary fully committed" so recovery reads know whether to replay or
  continue.
- Keep observability out of the contract. Structured logs, event streams, and
  daemon steering state remain Phase 2+ work.

## Phase 1 recovery contract

- Kill-resume and crash-recovery are equivalent at the Phase 1 store boundary.
  In-flight work is never resumed mid-step; recovery always replays from the
  last durable pre-step checkpoint.
- The run-level durable checkpoint is `runs.next_step_id` plus terminal
  run-status fields when no next step remains.
- Recovery reads derive behavior from durable state only:
  `runs.next_step_id` + attempt/outcome history from `step_attempts` and
  `step_outcomes`. No extra mutable "in-progress" source of truth is allowed.

## Recovery read outcomes

- `start-next-boundary`: no attempt exists yet for `runs.next_step_id`; start
  the next never-attempted boundary.
- `replay-last-boundary`: latest attempt for `runs.next_step_id` exists but has
  no committed boundary effect; replay that boundary from step start.
- `run-terminal`: run has terminal status and no next step; report terminal.

## Boundary commit evidence and idempotence

- Boundary completion is proven only by one committed transactional effect that
  contains all of:
  1. attempt marked terminal in `step_attempts`,
  2. terminal row in `step_outcomes`,
  3. run checkpoint advancement (`runs.next_step_id` update or terminal run).
- Retrying the same finished boundary write must be idempotent: no second
  checkpoint advancement, no duplicated terminal outcome effect.
- "Attempt recorded but checkpoint not advanced" is explicitly non-committed and
  must resolve to `replay-last-boundary` on recovery.

## Required recovery-oriented coverage

- `no-attempt-yet`: no attempt recorded for `runs.next_step_id` ->
  `start-next-boundary`.
- `attempt-without-checkpoint`: attempt start durable but no transactional
  boundary commit -> `replay-last-boundary`.
- `boundary-committed`: transactional commit durable -> checkpoint advanced once
  and not advanced twice by retry.
- `crash-before-checkpoint`: simulate failure before checkpoint advancement;
  recovery remains replayable and does not report committed boundary.

## Task Checklist

- Define the resume rules for completed, interrupted, and not-yet-started
  boundaries.
- Define the idempotence rules around boundary commit and checkpoint
  advancement.
- Define recovery-oriented tests that exercise crash-like partial writes and
  exact-once boundary advancement.
- Update the v2 docs that describe persistence and recovery ownership.

## Acceptance criteria

- [x] The subspec states that kill-resume and crash-recovery are the same at
      the Phase 1 state boundary: interrupted in-flight work replays from the
      last durable pre-step checkpoint rather than resuming mid-step.
- [x] The subspec defines one concrete durable checkpoint model on the run and
      requires recovery reads to derive replay behavior from that checkpoint
      plus durable attempt history, not from scattered mutable in-progress
      fields.
- [x] The subspec defines the recovery read outcomes explicitly enough to
      distinguish at least: start the next never-attempted boundary, replay the
      last interrupted boundary, or report the run terminal.
- [x] The subspec makes boundary idempotence explicit: retrying the same
      finished boundary write cannot advance resume state twice or duplicate the
      durable terminal effect.
- [x] The subspec states what durable evidence proves a boundary is committed:
      the checkpoint advancement and terminal attempt/outcome records appear in
      the same transactional effect, rather than being inferred from an
      in-memory flag.
- [x] The subspec requires coverage that distinguishes at least three cases:
      no attempt recorded yet, attempt recorded but checkpoint not advanced, and
      boundary fully committed.
- [x] The subspec requires coverage that proves the transactional boundary
      behavior from the API layer: a fully committed boundary is advanced once,
      and a simulated crash before checkpoint advancement remains replayable.
- [x] The subspec keeps mid-step snapshots, structured log/event history, human
      steering state, and daemon lifecycle concerns out of scope unless a
      concrete recovery read requires them.

## Documentation updates

- Update `v2/docs/v2-build-order.md` and `v2/docs/v2-architecture.md` so both
  documents say Phase 1 owns the boundary-checkpoint recovery contract and that
  later daemon work only triggers that recovery through another surface.
