# v2 coding standards

The canonical restraint principles for v2 development are defined in the prompt artifact `write.principles` (see [prompts/registry.txt](../../prompts/registry.txt)). All v2 implementation guidance derives from these seven principles.

For the full principle text and decision notes, consult the artifact source directly — it is the single authoritative copy and is injected into the write-step prompt at each iteration.

## Structural-honesty gates

A Biome linter gate enforces structural honesty in v2 and shared code via two rules:

- **`noExcessiveCognitiveComplexity`** (error, threshold 25): Functions exceeding cognitive complexity 25 are errors. The threshold is tuned to the green-on-existing line — existing v2/shared code passes, but complex new logic is gated. Smallness is the planner's and reviewer's job; the gate enforces structure, not size targets.
- **Shared import boundary** (error): Code under `shared/**` must not import from `v1/**` or `v2/**`. Shared is the lower-layer library consumed by both versions; enforcing its isolation prevents version-specific leakage.

All rules are error-level; no warnings are introduced. The gate scope covers `v2/src/**` and `shared/**` via Biome `overrides`, leaving `v1/**` untouched. Fixtures demonstrating violations are in `v2/test/fixtures/` and excluded from the regular build.

## Referenced documents

- [`v2-architecture.md`](./v2-architecture.md) — v2 design boundaries and module responsibilities
- [`v1-behaviors.md`](./v1-behaviors.md) — v1 behaviors that v2 does not replicate in this build window
