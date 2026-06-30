---
name: invocation-liveness-policy
---

# v2 invocation liveness policy

Operators see agent invocations go silent for a long time — often on the
post-completion **review-debate** actuator — then die at the **30-minute wall**
with little actionable signal. Harness liveness (stdout idle + optional file
mtime) does not match operator-visible "no progress." v1 copies watchdog wiring
per phase; v2 should define stall vs slow-work behavior once in the shared
invocation layer before Phase 6 ports review-debate.

## Problem

- **Stall** — process up, no useful progress toward the step outcome.
- **Slow work** — long but legitimate (test run, large edit pass).

v1 conflates them. True stalls often ride the full wall; productive silent
work gets false-killed or the operator hand-finalizes.

## Scope (for plan → run)

- Behavioral requirements doc: what v2 must distinguish and guarantee (not
  signal algorithms or timeout tables yet).
- Cross-links from `shared-invocation.md`, `v2-build-order.md`, `v1-behaviors.md`.
- Sequencing note: policy before Phase 6 review-debate; no v1 per-phase copy-paste.

## Out of scope

- Implementation (signals, kill paths, config knobs).
- Actuator prompt changes or workflow presets to skip post-completion review.

## Decisions (seed-level — refine in plan)

- Liveness is a **shared invocation** concern — not patch/review/shrink wiring
  duplicated per phase.
- Policy is **behavior- and role-aware** — one global idle ms is not the v2
  contract.
- True **stall** on short bounded steps (actuator apply) must not default to
  soaking the 30-minute wall.

## Documentation updates

- New `v2/docs/invocation-liveness.md` — durable behavioral home.
- `v2/docs/shared-invocation.md` — link to liveness doc.
- `v2/docs/v2-build-order.md` — cross-cutting note.

## Prerequisites

- `v2/docs/shared-invocation.md` (binding fallback seam).
- `v2/docs/v1-behaviors.md` (v1 idle + wall-clock for contrast).
- Behavior primitive renamed to **review-debate** in v2 docs (separate PR or
  landed).
