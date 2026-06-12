# Verdict

The implementation reproduces the two exact defects this spec's own planning ledger pre-flagged as blocking: an inert import boundary and a complexity gate weakened to absorb code the spec said to exclude. Subspec 01's two enforcement guarantees are both compromised, and the proof fixture conceals rather than exposes this. The 01 acceptance boxes do not hold as checked.

## Blocking — must fix before ready

**1. The `shared/**` import boundary is inert and must actually fire on a real import.**
All `noRestrictedImports` patterns use bare anchored globs (`v1/**`, `v2/**`). Every real cross-package import in the tree is relative (`../../shared/...`; a shared→v1 import would be `../../v1/...`). Bare anchored globs do not match relative specifiers, so the new `shared/**` boundary — subspec 01's headline guarantee — enforces nothing. The forbidden-import patterns must use relative-aware globs (`**/v1/**`, `**/v2/**`) verified against the specifier form shared/v2 code actually emits. The acceptance criterion must rest on an **empirically demonstrated Biome error against a realistic forbidden import** (the `../../v1/...` form), not on copying the existing pattern. v2's own currently-inert v2→v1 override should be corrected to the relative-aware form at the same time; v1's inert override stays untouched (v1 retrofit is out of scope).

**2. The boundary fixture must use the real import form and demonstrably go red.**
The fixture imports `from "v1/src/something.ts"` — a bare specifier that happens to match the bare glob, so the box ticks while the only import form shared code can actually write (`../../v1/...`) passes clean. Rewrite the fixture to the realistic relative form and show it produces an actual error under the corrected rule. As written, the shared-boundary acceptance criterion is unmet.

**3. Exclude test files from the complexity rule and re-derive the threshold.**
The spec is explicit: `*.test.ts` is excluded from the complexity override, and the threshold starts at the generous default (~15) and is lowered only if that default isn't green on existing non-test code — never raised above it. The implementation excludes no test files and sets the threshold to 25. Branchy test files (which exist) were left in scope, shifting the green-on-existing baseline, and 25 appears chosen to keep them passing — the baseline-shift the spec warned against. Exclude `*.test.ts` from both complexity overrides, then re-derive the threshold against non-test code from the ~15 floor. 25-with-tests-included is a materially different gate than the one specified.

## Required

**4. The seeded-violation proof must actually execute, and the threshold doc must tell the truth.**
The documented verification commands target paths under the Biome-ignored `!**/v2/test/fixtures` exclude; Biome skips ignored files even when named explicitly on the CLI, so those commands likely process no files and emit no error — a hollow proof. The proof must genuinely override the ignore (or be asserted by a test that confirms the fixtures are red), since this fixture is the sole evidence the gate bites. Once the threshold is re-derived (item 3), correct `coding-standards.md`: it currently claims the threshold is "tuned to the green-on-existing line," which is false if 25 is a ceiling chosen to keep test files green. The doc must state the actual non-test baseline rationale.

## Minor — tighten, not blocking on their own

**5. Loosen the render test from exact wording.** The test asserts seven exact title substrings. The principle text is meant to be tuned; the spec prefers a principle-count plus a stable marker over exact-phrase coupling. Titles are the more stable part, so this is lower severity, but it still breaks on any retitle.

**6. Fix the `prompts.md` layering line.** `write.principles -> write.execute` reads as fragment layering; the actual mechanism is placeholder substitution of the principles body into `<PRINCIPLES>` within `execute.md`. The "no global/behavior fragments" gloss is also loose given `principles.md` carries `behavior: write`. Doc-accuracy only.

## Rationale

Items 1–3 are not reviewer preference — they restate this spec's own accepted refinements (relative-aware globs with a demonstrated error; test-file exclusion; threshold as a floor not a ceiling). Leaving them unaddressed means two acceptance criteria pass while enforcing nothing, which is the precise failure mode the spec was written to prevent. Item 4 is the only evidence the gate bites and must be real. Items 5–6 align artifacts with stated intent but do not compromise enforcement.