# Invocation liveness policy

v1 conflates **stall** (process up, no useful progress toward the step outcome)
with **slow work** (long but legitimate). True stalls often ride the full
30-minute wall; productive silent work gets false-killed or the operator
hand-finalizes. Define v2's behavioral contract once in the shared invocation
layer before Phase 6 ports review-debate.

Design-only slice — no signal algorithms, timeout tables, kill paths, or config
knobs.

## Decisions

- **Liveness is shared-invocation-owned** — rules out duplicating watchdog wiring per patch/review/shrink phase or workflow loop.
- **Policy varies by behavior and role** — rules out one global `idleOutputTimeoutMs` as the v2 contract.
- **True stall on short bounded steps must not default to the 30-minute wall** — rules out treating review-debate actuator apply like an open-ended write pass.
- **Behavioral requirements only in this slice** — stall/slow distinction and guarantees, not algorithms — rules out pinning signal math or timeout tables here.
- **`invocation-liveness.md` is the durable behavioral home** — cross-link from other docs; do not duplicate stall/slow definitions — rules out scattering policy prose across phase docs.
- **v1 contrast via cross-link only** — `v1-behaviors.md` keeps the v1 catalog; liveness doc points there for idle-output + iteration wall-clock behavior — rules out rewriting v1 watchdog prose in the liveness doc.
- **Build-order gate is advisory prose** — Phase 6 review-debate depends on liveness policy committed on `main`; no harness mechanical gate — rules out scope creep into workflow enforcement.
- **Deferred to first consumer: signal algorithms and timeout tables** — pin when shared invocation implements liveness enforcement.
- **Deferred to first consumer: operator-visible stall diagnostics at termination** — pin when kill/report paths land.

## Task checklist

- Create `v2/docs/invocation-liveness.md`: stall vs slow-work definitions; operator-visible progress expectations; v2 guarantees (not implementation); shared-invocation ownership; behavior- and role-aware policy; short bounded steps (review-debate actuator apply as example); v1 contrast cross-link to `v1-behaviors.md`; deferred items inline.
- Update `v2/docs/shared-invocation.md`: link to `invocation-liveness.md`; state the invocation layer owns liveness policy (boundary alongside existing fallback/token-parse exclusions).
- Update `v2/docs/v2-build-order.md`: cross-cutting or Phase 6 note — liveness policy on `main` before Phase 6 review-debate ports.
- Update `v2/docs/v1-behaviors.md`: forward pointer or cross-link from idle-output / iteration wall-clock watchdog prose to `invocation-liveness.md` for v2 contrast.

## Acceptance criteria

- [ ] `v2/docs/invocation-liveness.md` exists and defines **stall** (process up, no useful progress toward the step outcome) and **slow work** (long but legitimate) as distinct operator-visible concepts.
- [ ] `v2/docs/invocation-liveness.md` states liveness is a **shared invocation** concern — one policy surface, not per-phase watchdog copy-paste.
- [ ] `v2/docs/invocation-liveness.md` states policy is **behavior- and role-aware** — one global idle ms is not the v2 contract.
- [ ] `v2/docs/invocation-liveness.md` states true **stall** on short bounded steps (e.g. review-debate actuator apply) must not default to soaking the 30-minute wall.
- [ ] `v2/docs/invocation-liveness.md` documents operator-visible **progress expectations** and v2 **guarantees** without pinning signal algorithms, timeout tables, kill paths, or config knobs.
- [ ] `v2/docs/invocation-liveness.md` cross-links to `v1-behaviors.md` for v1 idle-output + iteration wall-clock contrast.
- [ ] `v2/docs/invocation-liveness.md` records both deferred items: signal algorithms/timeout tables; operator-visible stall diagnostics at termination.
- [ ] `v2/docs/shared-invocation.md` links to `invocation-liveness.md` and states the invocation layer owns liveness policy.
- [ ] `v2/docs/v2-build-order.md` states liveness policy must land on `main` before Phase 6 review-debate.
- [ ] `v2/docs/v1-behaviors.md` cross-links (or forward-pointers) to `invocation-liveness.md` from idle-output / iteration wall-clock watchdog prose.

## Documentation updates

- `v2/docs/invocation-liveness.md` (new) — canonical behavioral home.
- `v2/docs/shared-invocation.md` — link; invocation layer owns liveness policy.
- `v2/docs/v2-build-order.md` — sequencing note before Phase 6 review-debate.
- `v2/docs/v1-behaviors.md` — cross-link for v1 idle + wall-clock contrast.
