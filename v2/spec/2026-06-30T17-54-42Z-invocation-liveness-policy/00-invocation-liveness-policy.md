# 00 — Invocation liveness policy

Design-only slice: document v2's behavioral contract for distinguishing **stall**
(process up, no useful progress toward the step outcome) from **slow work** (long
but legitimate). v1 conflates them — true stalls often ride the full 30-minute wall;
productive silent work gets false-killed or the operator hand-finalizes. Land the
policy in durable docs before Phase 6 ports review-debate.

## Out of scope

- Signal algorithms, timeout tables, kill paths, or config knobs.
- Actuator prompt changes or workflow presets to skip post-completion review.

## Prerequisites

- Shared invocation binding fallback seam is documented (`shared/invocation/execute.ts`
  contract in [`shared-invocation.md`](../../docs/shared-invocation.md)).
- v1 idle-output and iteration wall-clock watchdog behavior is cataloged in
  [`v1-behaviors.md`](../../docs/v1-behaviors.md).
- v2 loop primitives name **review-debate** (not review phase/loop) in durable v2
  docs.

## Decisions

- Liveness is shared-invocation-owned — rules out duplicating watchdog wiring per
  patch/review/shrink phase or behavior loop.
- Policy varies by behavior and role — rules out one global `idleOutputTimeoutMs`
  as the v2 contract.
- True stall on short bounded steps must not default to the 30-minute iteration
  wall — rules out treating review-debate actuator apply like an open-ended
  implementation pass.
- Behavioral requirements only in this slice — stall/slow distinction and
  guarantees, not algorithms — rules out pinning signal math or timeout tables
  here.
- Stall response recorded at category level — rules out per-phase kill semantics
  invented at enforcement time.
- Progress signals are multi-category and outcome-oriented — rules out v2 contract
  = global output-idle timer.
- Liveness profiles are behavior × role — rules out phase-name copy-paste of v1
  watchdogs.
- Build-order entry under Cross-cutting — rules out burying sequencing inside Phase
  6 preamble.
- Policy doc merge precedes Phase 6 review-debate; enforcement deferred to
  shared-invocation consumer — rules out reading build-order as "code must ship
  before any write invocation."
- Disambiguate invocation liveness from run orchestration liveness — rules out
  operator/doc collision with `isLive`.
- `shared-invocation.md` Boundary updated — rules out contradictory ownership prose.
- Deferred to first consumer: signal algorithms and timeout tables — pin when
  shared invocation implements liveness enforcement.
- Deferred to first consumer: operator-visible stall diagnostics at termination —
  pin when kill/report paths land.
- Deferred to first consumer: human-step interaction with invocation stall
  termination — pin when Phase 6 human behavior is specced.

## Task checklist

- [ ] Create `v2/docs/invocation-liveness.md` as canonical behavioral home:
  - Non-circular **stall** vs **slow work** definitions with positive examples
    (actuator applying verdict edits; implement touching acceptance-criteria files;
    read-only debate producing review artifacts) and a negative stall candidate
    (process up, no output, no outcome-relevant workspace movement).
  - Progress signal categories at behavioral level (agent output, workspace activity
    toward step outcome, step-completion markers); defer weights, intervals, and
    thresholds to first enforcement consumer.
  - Stall-response categories without kill-path wiring (terminal abort after bounded
    stall; binding advance when later rungs remain; role-dependent mix).
  - Liveness profiles as behavior × role (cross-link
    [`role-resolution.md`](../../docs/role-resolution.md)): distinct stall
    expectations for read-only debate roles vs `actuator`/`implement`; open-ended
    exemplar (`implement` under `write`) contrasted with short bounded exemplars
    (e.g. review-debate actuator apply).
  - Profile shape at category level: each behavior/role profile may combine stall
    detection and an absolute ceiling (v1 parallel idle + wall-clock is contrast
    baseline); defer profile tables.
  - Explicit **Guarantees** section: what v2 promises operators across profiles at
    termination and during legitimate long work — without algorithms or timeout
    tables.
  - **Stall ≠ quota**: stall termination is not quota exhaustion; binding advance on
    stall is separate from quota fallback; defer `failureKind`/telemetry to
    enforcement consumer.
  - Terminology disambiguation: **invocation liveness** (step/invocation progress)
    vs **run orchestration liveness** (`isLive`, daemon/list column).
- [ ] Update [`shared-invocation.md`](../../docs/shared-invocation.md) **Boundary**
  section: link to liveness doc; invocation owns liveness policy evaluation;
  workflow loops consume it.
- [ ] Update [`v2-build-order.md`](../../docs/v2-build-order.md) **Cross-cutting (not
  phases)**: policy doc merges before Phase 6 review-debate implementation.
- [ ] Update [`v1-behaviors.md`](../../docs/v1-behaviors.md): substantive contrast
  bullets (idle false-kill, stall riding 30-minute wall, patch-only escalation
  asymmetry); note v1 interim behavior (e.g. pending `review-actuator-idle-escalation`
  seed) vs v2 target policy.
- [ ] Run `bun run lint:md`.

## Acceptance criteria

- [ ] `v2/docs/invocation-liveness.md` defines **stall** and **slow work**
  non-circularly with positive examples (actuator verdict apply, implement touching
  acceptance-criteria files, read-only debate producing review artifacts) and a
  negative stall candidate (process up, no output, no outcome-relevant workspace
  movement).
- [ ] `v2/docs/invocation-liveness.md` documents progress signal categories
  (agent output, workspace activity toward step outcome, step-completion markers)
  and defers weights, intervals, and thresholds to first enforcement consumer.
- [ ] `v2/docs/invocation-liveness.md` documents stall-response categories
  (terminal abort after bounded stall; binding advance when later rungs remain;
  role-dependent mix) without kill-path wiring.
- [ ] `v2/docs/invocation-liveness.md` defines liveness profiles as behavior × role,
  cross-links `role-resolution.md`, and differentiates read-only debate roles from
  `actuator`/`implement`, with open-ended (`implement` under `write`) and short
  bounded (review-debate actuator apply) exemplars.
- [ ] `v2/docs/invocation-liveness.md` states profile shape at category level (stall
  detection plus optional absolute ceiling) and defers profile tables.
- [ ] `v2/docs/invocation-liveness.md` includes a **Guarantees** section (or
  equivalent) covering operator promises at termination and in-flight observability
  of legitimate long work (not pre-termination stall forensics).
- [ ] `v2/docs/invocation-liveness.md` states stall termination is not quota
  exhaustion and separates binding advance on stall from quota fallback.
- [ ] `v2/docs/invocation-liveness.md` disambiguates invocation liveness from run
  orchestration liveness (`isLive`).
- [ ] `v2/docs/invocation-liveness.md` states liveness policy is owned by the shared
  invocation layer (one policy surface, not per-phase watchdog copy-paste).
- [ ] `v2/docs/invocation-liveness.md` records deferrals for signal algorithms,
  timeout tables, operator-visible stall diagnostics at termination, and human-step
  interaction with invocation stall termination.
- [ ] `v2/docs/shared-invocation.md` **Boundary** section links to
  `invocation-liveness.md` and states invocation owns liveness policy evaluation;
  workflow loops consume it.
- [ ] `v2/docs/v2-build-order.md` **Cross-cutting (not phases)** records policy doc
  merge before Phase 6 review-debate implementation.
- [ ] `v2/docs/v1-behaviors.md` cross-links `invocation-liveness.md` with substantive
  v1 contrast (idle false-kill, stall riding 30-minute wall, patch-only escalation
  asymmetry) and notes v1 interim vs v2 target where they diverge.
- [ ] `bun run lint:md` passes.

## Documentation updates

- `v2/docs/invocation-liveness.md` (new) — canonical behavioral home.
- `v2/docs/shared-invocation.md` — Boundary link; invocation owns liveness policy
  evaluation.
- `v2/docs/v2-build-order.md` — Cross-cutting: policy doc merge before Phase 6.
- `v2/docs/v1-behaviors.md` — substantive v1 contrast + interim vs v2 target note.
