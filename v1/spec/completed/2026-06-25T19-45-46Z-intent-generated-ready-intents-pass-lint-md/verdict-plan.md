# Verdict — refinements required

The spec's core architecture is sound (autofix in the shared `repairIntentStageContent` step, ordering after structural repair and before validation, `lint:md` left authoritative) and should survive refinement. But two upheld defects make the current draft unshippable, plus several smaller gaps. Refine as follows.

## Required

**1. "Lint-clean" is the wrong correctness oracle — autofix is not meaning-preserving.**
The motivating input is a wrapped, line-leading `#499`. MD018's autofix inserts a space at the hash boundary, turning `#499` into `# 499` — promoting an issue reference to an H1 (and risking MD025/TOC cascades). The spec's only oracle ("emitted files are lint-clean") *passes on this corrupted output*, replacing a visible failure (lint fails, PR stays draft) with a silent degradation (PR readies with wrong content). The operator's real hand-fix here is almost certainly to un-wrap the reference, which autofix does not reproduce.
The spec must resolve this, not paper over it. Either: (a) prevent the emitter/structural repair from ever producing a line-leading `#NNN`, so MD018 never fires (fixes the root cause); and/or (b) scope explicitly which rules are safe to blind-autofix vs. which must be prevented at the source. Decisions must drop the conflation in bullet 1 ("autofix … cannot drift") — "matches lint's engine" is not "produces the correct document." Add a content-preservation guarantee (an issue reference stays a reference) as the oracle that proves the resolution works.

**2. "Autofixable rules only" undershoots the intent and ships residual failures silently.**
`validateIntentStageContent` checks only frontmatter and `## Prerequisites`; it does not re-lint. So a non-autofixable violation (MD041/MD025/MD026, some MD022) survives autofix, ships into `ready-intents/`, and fails `lint:md` in the ready tier anyway — the operator is back to hand-fixing, the exact north-star step the intent promises to eliminate. The scope language quietly narrows the intent's promise from "passes lint:md" to "passes the two observed rules." The spec must make residual post-autofix violations a **visible failure at fan-out** (fail emit, or surface a named warning, before the rename into `ready-intents/`), so the failure surfaces at generation time rather than invisibly at `ready`. This requires a Decision, an AC, and a defined error/warning surface.

**3. Define autofix exit-code handling.**
`markdownlint-cli2 --fix` exits non-zero when violations remain after fixing. The spec is silent on whether emit inspects this. This is the concrete lever for #2: respect the post-fix exit status so a still-dirty staged file fails before rename. Pin this as a Decision + AC.

**4. Pin how the harness lint config is located.**
The no-commit staging path runs with `cwd = project.root`, so cwd-based config discovery yields the wrong rule set. The spec names this risk but does not pin the seam. As a harness subspec, it should state *how* the `.markdownlint-cli2.jsonc` is resolved (relative to a known harness-repo anchor, not cwd) and that it is passed explicitly. One Decision line closes this.

**5. Tighten the test so it cannot pass vacuously.**
If the explicit-path wiring or config resolution were wrong, autofix would be a silent no-op and a cleanliness assertion on the output would still pass. The test must assert the input was dirty pre-fix (or that autofix changed the bytes) and clean after — not merely clean after.

**6. Add a no-commit-path acceptance criterion.**
Decisions make "both commit and no-commit paths, no path-specific branch" an invariant, and the config-resolution risk bites specifically on the no-commit branch. An AC asserting external/no-commit staging is also autofixed against the harness config guards the riskiest branch.

**7. Fix AC #4 wording.**
The existing repair tests call the repair step directly on seeded staging dirs; real fan-out needs an agent CLI. "Drives fan-out" overclaims an e2e path the `*.sandbox-unrunnable` test will not exercise. Reword to "exercises the emit-contract repair step on seeded staging content containing MD012/MD018."

## Rationale

Findings #1 and #2/#3 are load-bearing because they break the intent's central promise — emitted ready-intents pass `lint:md` with no operator intervention. The current draft can ship a corrupted document that *passes* its own oracle (#1) or a residually-dirty document that fails downstream where the failure is invisible until `ready` (#2). Both reinstate the manual step the intent exists to remove. #4–#7 close seams and prevent a vacuously-passing test, consistent with the harness-subspec convention that structure-as-contract may be named and with the refactor/behavior-change discipline that ACs assert verifiable behavior rather than assumed shape.