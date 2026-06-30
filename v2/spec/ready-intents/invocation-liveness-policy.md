---
name: invocation-liveness-policy
---

# v2 invocation liveness policy

Document v2's behavioral contract for distinguishing **stall** (process up, no useful progress toward the step outcome) from **slow work** (long but legitimate). v1 conflates them: true stalls often ride the full 30-minute wall; productive silent work gets false-killed or the operator hand-finalizes. Define the policy once in the shared invocation layer before Phase 6 ports review-debate.

Design-only slice — no signal algorithms, timeout tables, kill paths, or config knobs.

## Scope

- Create `v2/docs/invocation-liveness.md` as the durable behavioral home: stall vs slow-work definitions, operator-visible progress expectations, and v2 guarantees (not implementation).
- State liveness is a shared invocation concern — one policy surface, not per-phase watchdog copy-paste.
- State policy is behavior- and role-aware — one global idle ms is not the v2 contract.
- State true stall on short bounded steps (e.g. review-debate actuator apply) must not default to soaking the 30-minute wall.
- Contrast v1 idle-output + iteration wall-clock behavior via cross-link to `v1-behaviors.md`.
- Cross-link from `shared-invocation.md` (invocation layer owns liveness).
- Add build-order sequencing note: policy lands before Phase 6 review-debate.

## Out of scope

- Implementing signals, kill paths, or config knobs.
- Actuator prompt changes or workflow presets to skip post-completion review.

## Decisions

- **Liveness is shared-invocation-owned** — rules out duplicating watchdog wiring per patch/review/shrink phase.
- **Policy varies by behavior and role** — rules out one global `idleOutputTimeoutMs` as the v2 contract.
- **True stall on short bounded steps must not default to the 30-minute wall** — rules out treating actuator apply like an open-ended implementation pass.
- **Behavioral requirements only in this slice** — stall/slow distinction and guarantees, not algorithms — rules out pinning signal math or timeout tables here.
- **Deferred to first consumer: signal algorithms and timeout tables** — pin when shared invocation implements liveness enforcement.
- **Deferred to first consumer: operator-visible stall diagnostics at termination** — pin when kill/report paths land.

## Documentation updates

- `v2/docs/invocation-liveness.md` (new) — canonical behavioral home.
- `v2/docs/shared-invocation.md` — link to liveness doc; state invocation layer owns liveness policy.
- `v2/docs/v2-build-order.md` — cross-cutting note: liveness policy before Phase 6 review-debate.
- `v2/docs/v1-behaviors.md` — cross-link to liveness doc for v1 idle + wall-clock contrast (or brief forward pointer if a dedicated subsection is excessive).

## Prerequisites

- Shared invocation binding fallback seam is documented (`shared/invocation/execute.ts` contract in `v2/docs/shared-invocation.md`).
- v1 idle-output and iteration wall-clock watchdog behavior is cataloged in `v2/docs/v1-behaviors.md`.
- v2 loop primitives name **review-debate** (not review phase/loop) in durable v2 docs.
