# 01 — Biome structural-honesty gate

A hard Biome gate over `v2/src/**` + `shared/**` enforcing *structural
honesty*, not smallness. Smallness is the planner's/reviewer's job and a
deterministic size cap is gameable. All rules are errors; no warnings.

## Decisions

- Native Biome only: `noExcessiveCognitiveComplexity` + an extended
  import-boundary rule. Rules out a multi-tool lint pipeline (jscpd/GritQL for
  duplicate-code, max-params) — adding one for v2-only scope is itself the
  speculative-config/over-build failure this work forbids. max-params is
  redundant with the options-object idiom; telemetry duplication is the
  separate-decision-from-effect principle's job (subspec 00 + review).
- `shared/**` gets the full native set, including its own boundary forbidding
  imports from `v1/**` and `v2/**` (per AGENTS.md). Rules out gating only
  `v2/src/**` and leaving `shared/**` ungated — shared is the lower layer both
  versions consume, costliest to leave unenforced.
- All rules `error`, never `warn`. Rules out warning-level rules, which get
  ignored, become clutter, and erode the blocking rules' credibility.
- Scope via Biome `overrides` (same mechanism as the existing
  `noRestrictedImports` v1↔v2 blocks). Rules out a separate config file or
  global rule that would touch v1.
- `max-lines` / `max-lines-per-function` excluded — most gameable; size signal
  lives in plan + review, not the gate.
- Seeded-violation proof runs Biome out-of-band against a fixture (test-driven
  or an excluded fixture path), not a violation committed into the linted tree.
  Rules out leaving a permanent red in `bun run check`.

Deferred to first consumer: the exact `noExcessiveCognitiveComplexity`
numeric threshold — pin when the gate first runs against existing v2/shared
code. Start ~15 cognitive and tune to the green-on-existing line. Not fixed
now because the right number is the empirical green-on-existing boundary,
unknowable until the rule runs.

## Task checklist

- [ ] Add `noExcessiveCognitiveComplexity` (error) over `v2/src/**` +
  `shared/**` via `overrides`; set the threshold to the lowest value that is
  green on current v2/shared code.
- [ ] Extend the import boundary: add a `shared/**` override forbidding imports
  from `v1/**` and `v2/**` (errors), alongside the existing v1↔v2 blocks.
- [ ] Add a seeded over-complexity (and/or boundary-violation) fixture proven
  red by Biome out-of-band, without breaking `bun run check`.

## Acceptance criteria

- [x] `bun run check` is green on the existing repo with the new rules active.
- [x] A seeded over-complexity violation under `v2/src/**` (or `shared/**`) is
  reported as a Biome **error** (verified out-of-band / by test), proving the
  complexity gate bites.
- [x] A `shared/**` file importing from `v1/**` or `v2/**` is reported as a
  Biome **error**; a clean `shared/**` file is not.
- [x] All added rules are level `error`; no `warn`-level rule is introduced.
- [x] The gate's `overrides` cover both `v2/src/**` and `shared/**`; `v1/**` is
  untouched by the new complexity rule.
- [x] `bun run typecheck` and `bun test` pass.

## Documentation updates

- `v2/docs/coding-standards.md`: document the Biome gate — the complexity rule,
  the extended `shared/**` import boundary, error-only policy, and the chosen
  threshold (with the green-on-existing rationale).
- `v2/docs/v1-behaviors.md`: no change — lint scope is v2/shared-only; no v1
  behavior changes.
