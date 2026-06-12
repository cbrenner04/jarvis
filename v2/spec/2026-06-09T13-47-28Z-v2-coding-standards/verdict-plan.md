Confirmed against the config. The existing `noRestrictedImports` overrides use bare anchored globs (`group: ["v1/**"]`, `["v2/**"]`) while every actual cross-package import is relative (`../../shared/...`, and a v2→v1 import would be `../../v1/...`). A bare `v1/**` will not match `../../v1/...`, so the existing v1↔v2 rules appear to be inert no-ops never exercised by any real violation. This makes finding #1 the load-bearing catch.

---

# Verdict

The spec's core decisions are sound — v2-only scope, single-source principle discipline, plan/review deferral against absent consumers, native-Biome-only gate with `max-lines` excluded. No core decision needs reversing. The required refinements are all about under-specified *mechanism* that would let an acceptance criterion pass while the gate is actually inert or self-contradictory.

## Blocking — must fix before ready

**R1. Import-boundary patterns must match relative specifiers, and acceptance must require a demonstrated red.**
The existing v1↔v2 `noRestrictedImports` blocks use bare anchored globs (`v1/**`, `v2/**`), but every real cross-package import in the tree is relative (`../../shared/...`; a v2→v1 import would be `../../v1/...`). Bare globs do not match relative specifiers, so the existing rules are effectively inert — and the spec's instruction to copy "the same pattern as the existing block" inherits that defect. The `shared/**` boundary must use relative-aware patterns (e.g. `**/v1/**`, `**/v2/**`) verified to actually match the specifiers v2/shared code uses. The acceptance criterion must require an *empirically demonstrated* error on a real forbidden import, not "mirrors the existing block." Without this, subspec 01's headline guarantee can pass while enforcing nothing.

**R2. Resolve the complexity-threshold contradiction.**
The intent, Decisions, and deferral say "start generous (~15), tune so the gate doesn't fire constantly," but subspec 01's task checklist says "lowest value that is green on current v2/shared." These are opposites: lowest-green pins the threshold one notch above today's worst function and will fail the next legitimately-complex one — exactly the constantly-firing gate the intent forbids. Drop "lowest value that is green"; the gate starts at the generous default and is lowered only if that default isn't already green on existing code.

## Required — resolve in refine

**R3. Pin one seeded-violation mechanism.**
A fixture under `v2/src/**`/`shared/**` is in scope of both the override and `bun run check`, so it would leave a permanent red. The spec names the goal (out-of-band, not committed into the linted tree) but offers two behaviorally different options ("test-driven or excluded fixture path") without choosing. Pick exactly one mechanism (e.g. fixture under an ignored path, linted via an explicit targeted invocation) — this fixture is the central proof that the gate bites, so it cannot stay ambiguous.

**R4. Decide test-file treatment under the complexity rule.**
`v2/src/*.test.ts` and `shared/*.test.ts` exist and would fall under `noExcessiveCognitiveComplexity`. Test scaffolding is legitimately branchy and also shifts the green-on-existing baseline (R2). State explicitly whether test files are excluded from the complexity override or deliberately included.

**R5. Pin write-prompt injection composition and ordering.**
The ledger correctly chose the injected-body path over `assemblePromptForStep`, but leaves open which placeholder carries the principles (STEP_RULES vs. a dedicated placeholder) and how they compose/order with the existing terminal-token step rule. Given the intent's explicit "survive prompt pressure" (recency) concern, ordering is load-bearing. Specify who composes principles + the existing step rules and in what order.

## Cheap pins — name them

**R6.** Name the artifact's frontmatter contract (kind/behavior, loaded by id rather than via behavior-assembly) so the implementer doesn't reach for `assemblePromptForStep`.

**R7.** Loosen the render test from exact-wording phrases to a count/stable-marker assertion. The principle text is meant to be tuned; coupling the test to exact wording fights that intent (the spec already prefers this; only the acceptance criterion hardened to the brittle form).

**R8.** State the `coding-standards.md` ownership/order: subspec 00 creates it as a thin pointer; subspec 01 augments it with the gate documentation. The two subspecs run independently, so the dependency must be explicit.

**R9.** Pin the rule id and option key (`noExcessiveCognitiveComplexity` / its `maxAllowedComplexity` option) in the deferral so the threshold deferral is actionable without guessing.

## Non-issue (no action)

The `shared/**/*.ts` glob recursion concern is moot — it recurses identically to the existing `v2/src/**/*.ts` override and covers nested `shared/` dirs. A one-line verify at most, not a gap.