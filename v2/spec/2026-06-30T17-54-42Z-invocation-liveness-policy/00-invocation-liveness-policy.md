# 00 — Invocation liveness policy

Design-only slice: document v2's behavioral contract for distinguishing **stall**
(process up, no useful progress toward the step outcome) from **slow work** (long
but legitimate). v1 conflates them — true stalls often ride the full 30-minute wall;
productive silent work gets false-killed or the operator hand-finalizes. Land the
policy in durable docs before Phase 6 ports review-debate.

No signal algorithms, timeout tables, kill paths, or config knobs in this slice.

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
- Deferred to first consumer: signal algorithms and timeout tables — pin when
  shared invocation implements liveness enforcement.
- Deferred to first consumer: operator-visible stall diagnostics at termination —
  pin when kill/report paths land.

## Task checklist

- [ ] Create `v2/docs/invocation-liveness.md` as canonical behavioral home:
  stall vs slow-work definitions, operator-visible progress expectations, v2
  guarantees (not implementation).
- [ ] State liveness is a shared invocation concern — one policy surface, not
  per-phase watchdog copy-paste.
- [ ] State policy is behavior- and role-aware.
- [ ] State true stall on short bounded steps (e.g. review-debate actuator apply)
  must not default to soaking the 30-minute wall.
- [ ] Contrast v1 idle-output + iteration wall-clock behavior via cross-link to
  [`v1-behaviors.md`](../../docs/v1-behaviors.md).
- [ ] Update [`shared-invocation.md`](../../docs/shared-invocation.md): link to
  liveness doc; state invocation layer owns liveness policy.
- [ ] Update [`v2-build-order.md`](../../docs/v2-build-order.md): cross-cutting
  note that liveness policy lands before Phase 6 review-debate.
- [ ] Update [`v1-behaviors.md`](../../docs/v1-behaviors.md): cross-link to
  liveness doc for v1 idle + wall-clock contrast (brief forward pointer
  acceptable).
- [ ] Run `bun run lint:md`.

## Acceptance criteria

- [ ] `v2/docs/invocation-liveness.md` exists and defines **stall** and **slow
  work** as distinct concepts with operator-visible progress expectations.
- [ ] `v2/docs/invocation-liveness.md` states liveness policy is owned by the
  shared invocation layer (one policy surface, not per-phase watchdog
  copy-paste).
- [ ] `v2/docs/invocation-liveness.md` states policy varies by behavior and role
  (not one global idle timeout as the v2 contract).
- [ ] `v2/docs/invocation-liveness.md` states true stall on short bounded steps
  (e.g. review-debate actuator apply) must not default to the 30-minute
  iteration wall.
- [ ] `v2/docs/invocation-liveness.md` records deferrals for signal algorithms,
  timeout tables, and operator-visible stall diagnostics at termination.
- [ ] `v2/docs/shared-invocation.md` links to `invocation-liveness.md` and states
  the invocation layer owns liveness policy.
- [ ] `v2/docs/v2-build-order.md` records that invocation liveness policy lands
  before Phase 6 review-debate.
- [ ] `v2/docs/v1-behaviors.md` cross-links `invocation-liveness.md` for v1
  idle-output and iteration wall-clock watchdog contrast.
- [ ] `bun run lint:md` passes.

## Documentation updates

- `v2/docs/invocation-liveness.md` (new) — canonical behavioral home.
- `v2/docs/shared-invocation.md` — link; invocation layer owns liveness policy.
- `v2/docs/v2-build-order.md` — liveness policy before Phase 6 review-debate.
- `v2/docs/v1-behaviors.md` — cross-link for v1 idle + wall-clock contrast.
