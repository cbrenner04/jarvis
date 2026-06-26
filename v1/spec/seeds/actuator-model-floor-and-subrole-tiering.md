---
name: actuator-model-floor-and-subrole-tiering
---

# Enforce an actuator model floor and sub-role model tiering

## Problem

The model-tiering decision (`deterministic-model-tiering-policy` /
`actuator-role-model-floor`, locked in the 2026-06-22/23 overlord reports) was
never turned into actionable work. Two consequences keep recurring:

1. **No actuator floor.** Actuators (patch, review-actuator, shrink-actuator —
   all resolve from `modes.patch.agentOrder`) can run on, or fall back to, a
   model below a usable actuation floor. Haiku as the patch primary has been
   observed weakening correct code (`match[1]!.trim()` → `?.` regression) and
   making out-of-scope edits a one-line test change sprawled into `tsconfig.json`
   / `package.json` / `spawn.ts` / `gh.ts` and a dozen test files (this session,
   2026-06-26). Quota/error fallback can silently drop an actuator below the
   floor with no guard.
2. **No sub-role granularity.** Config only tiers per *mode* (`patch`/`plan`/
   `prompt`/`review`), not per *sub-role*. The read-only review roles (adversary
   /advocate/adjudicator) and the review/shrink actuators all collapse onto one
   order, so a cheap reviewer tier cannot be set independently of an
   actuation-grade actuator tier.

Operators currently mitigate by hand-editing `~/.jarvis/config.json` agentOrders
(done 2026-06-26: codex primary for patch, haiku removed) — the manual step the
north star eliminates.

## Direction

- **Actuator floor:** define a configurable minimum-capability floor for
  actuation roles; never select (initial or fallback) an actuator model below
  it. Surface a clear error if no in-order actuator meets the floor rather than
  silently degrading.
- **Sub-role tiering:** allow per-sub-role model assignment (read-only review
  roles vs. review/shrink actuators vs. patch actuator) instead of one
  `patch.agentOrder` serving all actuators. Keep the existing per-mode order as
  the default when a sub-role override is absent.
- Plan weighs config shape (additive sub-role keys vs. a tiering block) and how
  the floor interacts with quota fallback.

## Out of scope

- Choosing specific model assignments for the operator's setup (that stays in
  `config.json`).
- Building a dynamic difficulty-scorer that picks tiers per task — start with
  static floors + sub-role overrides.

## References

- Prior decisions: `deterministic-model-tiering-policy`,
  `actuator-role-model-floor` (2026-06-22-overlord-batch.md, 2026-06-23 report).
- Role→order resolution: `v1/docs/agents.md` (tiering section), `v1/src/config.ts`.
- Observed haiku-actuator failures: this session and 2026-06-22 batch report.
