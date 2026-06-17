I'll verify the key claims against the actual code before issuing my verdict. The most consequential finding is the revision/snapshot contradiction, so let me ground that first.Let me find the actual locations of these files.The prompts live at repo root `prompts/`, not `v1/prompts/`. This is a notable detail — the spec's task references `prompts/shared/pr-description.md` (correct) but the doc-update target and AC7 reference `v1/test/fixtures/...`. Let me read the actual files now.Confirmed: fragment `shared.pr-description` is `revision: 2`; both step prompts (`patch.prompt.pr-description`, `plan.prompt.pr-description`) are `revision: 1`, and both layer the fragment via `add: [shared.pr-description]`. Now let me check the snapshot test, the fixtures, the generator script, and the governance doc.Confirmed: fixtures are named `@r1` and live under `v1/test/fixtures/...`, the generator script is at `scripts/` (repo root, not `v1/`). Let me read the snapshot test, the fixtures, the generator script, and the relevant governance section.This confirms the core finding definitively. The fixture filename is `@r1` (from the **step** revision), the snapshot test hard-asserts step revisions = `"1"` (lines 102-103), the fixture body embeds the fragment text verbatim (lines 13-20), and the generator script hardcodes `@r1` in four places (lines 22-23, 26-27).

Critically — the fragment is **already** at `revision: 2` while fixtures are `@r1`. This means the fragment revision number is already decoupled from the fixture naming. The fixtures key on the **step** revision, not the fragment revision. Now let me confirm the governance rule and check `generatePrDescription` impls plus the injection paths.This is the decisive finding. The governance rule (`prompts.md:101`) reads: **"Bump `revision` only when rendered output bytes for that `id` change."** And `prompts.md:103`: **"Snapshot keys are revision-aware: `<id>@r<revision>...`."**

The fixture `id` is `patch.prompt.pr-description` / `plan.prompt.pr-description` (the **step** prompts at `@r1`). Editing the fragment body changes the rendered bytes of those step `id`s (the fixture embeds the fragment text), so per the rule, **the step revisions must bump to 2**, fixtures become `@r2`, and the test assertions (lines 102-103) plus generator hardcodes (lines 22-23, 26-27) all must change.

The spec says only "bump the fragment's revision" — which is mechanically irrelevant to the snapshot contract (the fragment is already at `revision: 2` with `@r1` fixtures, proving the fragment number doesn't drive fixture naming). Confirmed unsatisfiable as written. Now the injection paths and `generatePrDescription` impls.Confirmed several findings:
- `generatePrDescription` (patch) returns whole `result.stdout.trim()` gated only on `includes("Decisions:")` (lines 76-81).
- `buildSpecContext` injects raw subspec file bodies unescaped (lines 87-101).
- The prompt uses `renderTemplateWithDeclarations`, NOT `enforceDelimiterPolicy` — confirming the advocate's nuance that the runtime delimiter rejection does not fire on this prompt.
- `updatePrBody` → `generatePrDescription` (line 155) — so the rewrite path also routes through extraction.

Now let me check the render.ts delimiter policy, the plan-mode pr.ts, and the v1-behaviors entries.Confirmed all the structural claims:
- Plan-mode `generatePrDescription` is identical in shape (whole stdout, `includes("Decisions:")`, lines 377-382).
- Plan `buildSpecContext` (lines 388-407) injects raw file bodies unescaped, same as patch.
- `updatePlanPrBody` → `generatePrDescription` (line 470) → regeneration also routes through extraction.
- `enforceDelimiterPolicy` exists (render.ts:76-88) and rejects values containing `<<<...>>>`, but is NOT called by the pr-description prompt builders — confirming the advocate's nuance.

Now the v1-behaviors entries to verify finding #4 (entries 242-245), and the worktrees-and-commits narrative section.Confirmed finding #4. The four entries:
- **242** — patch draft PR creation/generation (spec names it).
- **243** — patch **rewrite** path (regenerates narrative via `generatePrDescription`; spec does NOT name it).
- **244** — plan `updatePlanPrBody` generation (spec names it).
- **245** — plan **rewrite** path (regenerates via `generatePrDescription`; spec does NOT name it).

Since the rewrite paths (243/245) also route through `generatePrDescription` (verified at patch/pr.ts:155 and plan/pr.ts:470), leaving them describing whole-stdout behavior rots the baseline. Now the worktrees-and-commits narrative section.I have everything I need. The doc-update target `v1/docs/worktrees-and-commits.md` (lines 140-178) is the right home and exists. I notice the spec's doc-update list and AC7 correctly point to `v1/test/fixtures/...` and `v1/docs/...`, but the prompt fragment task references `prompts/shared/pr-description.md` (repo-root, correct) — these paths are consistent with reality.

One more check: let me confirm the plan-mode `pr-description-prompt.ts` also uses bare `renderTemplateWithDeclarations` (not `enforceDelimiterPolicy`), to be sure the injection-collision nuance applies symmetrically.Confirmed symmetric: plan-mode also uses bare `renderTemplateWithDeclarations`, no `enforceDelimiterPolicy`. Both `INTENT` and `SPEC_CONTEXT` carry unescaped injected content.

I now have full grounding on every finding. Let me synthesize the verdict.

**Verdict assessment summary:**
- **#1** (revision/snapshot): VALID, blocking. The fragment is already `revision: 2` with `@r1` fixtures — proving fixtures key on the **step** revision, not the fragment. Editing the fragment changes step rendered bytes → must bump step revisions, rename fixtures `@r2`, update test assertions and generator hardcodes. Spec's "bump the fragment's revision" is mechanically irrelevant.
- **#2** (token form + injection collision): VALID. Real risk is unescaped `SPEC_CONTEXT`/`INTENT` injection (not `enforceDelimiterPolicy`, which isn't wired here). Token must be pinned and collision-resistant.
- **#3** ("malformed" undefined): PARTLY valid — define "malformed", add no-closing and closing-before-opening cases.
- **#4** (v1-behaviors 243/245): VALID — rewrite paths route through extraction too.
- **#5** (`Decisions:` substring gate): VALID as one-line scope clarification.
- **#6** (null-path body-assembly AC): VALID — grades the intent's actual symptom.
- **#7** (hash-guard input changes): VALID nuance — one-line decision record.
- **#8/#9**: #8 folds into #1; #9 not split-worthy.

Now writing the self-contained verdict.

# Verdict — Required Refinements (First Review Pass)

The spec's core direction (code-side extraction over a third prompt-only attempt) is sound and the decision ledger is well-formed. The defects below are precision and bookkeeping, but two of them (R1, R2) sit exactly where the prior two prompt-only fixes failed, so they are blocking, not polish.

## R1 — Reframe revision/snapshot handling around the step prompts (BLOCKING)

The spec's snapshot/revision handling is mechanically wrong and, as written, jointly unsatisfiable with the governing rule.

- The PR-description fragment (`shared.pr-description`) is **already** at `revision: 2`, yet the rendered fixtures are named `@r1`. This proves the fixtures and the snapshot test key on the **step** prompt revisions (`patch.prompt.pr-description`, `plan.prompt.pr-description`, both currently `revision: 1`), not the fragment's revision number.
- The fixtures embed the fragment body verbatim. Per the prompt-governance rule ("bump `revision` only when rendered output bytes for that `id` change"; "snapshot keys are `<id>@r<revision>`"), editing the fragment body changes the rendered bytes of **both step `id`s**, which obligates bumping **both step revisions** to 2 and renaming fixtures to `@r2`.
- Consequently, the snapshot test's hard assertions that the step revisions equal `"1"` and the `@r1` fixture filenames both break, as do four hardcoded `@r1` filename literals in the snapshot-generator script (`scripts/generate-pr-description-snapshots.ts`).

Required outcome: the spec must drive its revision handling and fixture renames off the **step** prompts (bump both step revisions, rename both fixtures to `@r2`), update the snapshot test's revision assertions and fixture-name references, and update the generator script's hardcoded filenames. Acceptance criterion AC7 (which pins `@r1` filenames) and the decision rationale that bumping "the fragment's revision … reflects the changed fragment body" must be corrected — the fragment revision is not what the snapshot contract keys on. Whether the fragment's own revision also bumps is a secondary, defensible call, but it must not be presented as the mechanism that keeps the snapshot contract consistent.

## R2 — Pin the sentinel token and rule out collision with injected spec content (BLOCKING)

The spec names no concrete sentinel token, constrains no shape, and rules out no collision. This is a first-consumer-load-bearing choice with observable consequences (a Unicode-guarded literal vs. a reused `<<<…>>>` form vs. an HTML comment are materially different), so it must be pinned in the spec rather than deferred.

The real risk is on the **input** side, not the runtime delimiter policy. The PR-description prompt builders inject raw spec/intent/subspec file bodies **unescaped** (`SPEC_CONTEXT` in both modes, plus `INTENT` in plan mode) and do **not** invoke the reserved-delimiter guard. So a spec or intent file whose text literally contains the chosen closing sentinel would place that token inside the model's input, and the "first opening → next closing" extraction could latch onto a sentinel that originated in injected content — reintroducing the original bug class (untrusted text leaking into the narrative) from the input side.

Required outcome: the spec must name the exact literal sentinel token(s) and add a decision/criterion ensuring extraction cannot be fooled by injected content — either by requiring a token improbable in ordinary spec/intent prose, or by guarding/escaping the injected `SPEC_CONTEXT`/`INTENT` against containing the token. State which it is.

## R3 — Define "malformed" and add the missing edge-case criteria

"Malformed" is used as a load-bearing term in three acceptance criteria but is never defined, so those criteria are not deterministically testable. The disambiguation algorithm ("first opening → next closing") is stated, so this is a coverage/precision gap, not a contradiction.

Required outcome: define what "malformed" means and ensure criteria cover at least: opening present but closing absent (truncated output) → `null`; closing appears before opening → `null`. Keep these consistent with the token-collision resolution from R2.

## R4 — Bring all four v1-behaviors PR-narrative entries into line

The spec updates only the two generation entries (patch draft-PR generation; plan `updatePlanPrBody` generation) and leaves the two adjacent **rewrite/regeneration** entries (patch PR-body rewrite; plan PR-body rewrite) untouched. Both rewrite paths route narrative regeneration back through the same `generatePrDescription`, so leaving them describing whole-stdout behavior rots the v1 parity baseline.

Required outcome: update (or explicitly reconcile) all four PR-narrative entries to reflect sentinel-delimited extraction and the malformed/absent → no-narrative (deterministic-header) fallback, so the baseline stays accurate for both first-generation and rewrite paths.

## R5 — Record the consequential interactions the "out of scope" line waves at

Two interactions are real consequences of this change and must be recorded rather than implied:

- **`Decisions:` gate.** The gate stays a naive `includes("Decisions:")` substring check, now applied to the extracted region. Given the bug's lineage is a too-weak gate, the spec must state in one line that retaining the substring gate (vs. tightening to a header match) is intentional and out of scope — so a reviewer can distinguish intent from oversight.
- **Generated-narrative hash guard.** The hash that distinguishes machine-owned from human-edited narrative now hashes the **extracted** block instead of whole stdout. Changing `pr.ts` markers/guard is correctly out of scope, but the guard's **input** changes as a direct consequence, affecting round-trip generated-vs-edited detection. Add a one-line decision noting the guard now hashes the extracted block (intended).

## R6 — Add a null-path body-assembly acceptance criterion

Every behavioral criterion currently grades `generatePrDescription`'s return value in isolation. The intent's actual observed symptom (a PR body that opened with "I'll review the actual spec files on disk…") lives one layer up, in body assembly: on `null`, patch must assemble a header-only body and plan must emit no narrative section. A regression that correctly returns `null` but mis-assembles the body would pass every current criterion.

Required outcome: add at least one criterion asserting the observable end-to-end body outcome on the null path (header-only, no leaked preamble) for the modes' body-assembly path — grading the symptom the intent names, not just the extractor's return value.

---

The single-subspec framing remains acceptable (one behavior: extraction), but only once R1's revision/snapshot bookkeeping is made explicit — that hidden surface is what the single-subspec shape currently obscures.