I'll verify the key claims against the actual code before issuing my verdict. The most consequential findings concern the rewrite-path behavior and documentation gaps, so let me ground those first.Both rewrite-path claims are confirmed: on `null` regen, `narrative` retains its prior value (patch/pr.ts:177-179, plan/pr.ts:492-494). Now let me verify the v1-behaviors entries, the AC8 wording, the dead-test helpers, and the worktrees-and-commits doc.Both doc findings confirmed: v1-behaviors entries 244 and 246 (rewrite/regeneration) still say "regenerating the narrative when empty and an agent is available" with no sentinel language, while the spec's `## Documentation updates` explicitly requires all four entries updated. The worktrees doc also has the gratuitous re-indent. Now let me verify the dead test helpers and AC8's exact wording.Both `_createMockAgent` helpers are confirmed dead (defined, never invoked — the underscore prefix is a lint-silencer preserving dead code). The `buildPrBody`/`updatePrBody` tests that pass `narrative: null` (lines 62-96) hand-pass null and predate this spec — none drive preamble stdout end-to-end through `generatePrDescription` → body assembly. Let me confirm the AC8 wording and the prompt fragment's echoed-example risk.I have full grounding on every finding. Let me synthesize the verdict.

**Assessment summary:**
- **B1** (AC8 false on rewrite path): VALID. Confirmed at patch/pr.ts:177-179 and plan/pr.ts:492-494 — on `null` regen, prior machine narrative is preserved, not cleared. AC8's unconditional "header-only / no narrative on null" claim holds only on first generation. Doc/AC precision defect; the rewrite behavior itself is defensible.
- **B2** (no end-to-end null-path body test): VALID. Confirmed — no test pipes preamble/malformed stdout through `generatePrDescription` → body assembly. AC8 explicitly grades "the observable end-to-end body outcome" (the intent's literal symptom), but was ticked with unit-level extractor assertions.
- **B3** (only 2 of 4 v1-behaviors entries updated): VALID, highest confidence. Entries 244/246 unchanged despite the subspec's `## Documentation updates` explicitly requiring all four. Both rewrite paths route through the new extraction.
- **Q1** (dead `_createMockAgent` helpers): VALID. Both confirmed dead, underscore-silenced. Cleanliness, low effort.
- **Q3** (gratuitous re-indent in worktrees doc): VALID minor. Confirmed; will most likely render fine but is needless diff churn.
- **L1** (echoed-example residual risk): VALID nuance. The fragment now embeds a sentinel-wrapped template containing `Decisions:`; an echoing model could leak placeholder text. Acceptably less severe; record, don't guard.
- **L2** (no multiple-opening test): VALID, low priority. Disambiguation rule implemented but untested.
- **Q2** (out-of-scope `existsSync` removal): minor; note, don't block.

The B-series (B1/B3 doc-contract, B2 missing assertion) are the same gaps the prior plan-review flagged (R4/R6) and were ticked without being fully closed — strongest signal to close now.

---

# Verdict — Required Outcomes

The core change is sound: code-side sentinel extraction is correctly implemented and symmetric across both modes, the injected-content guard is wired in both builders against both injected values, the absent/malformed/missing-`Decisions:` paths are correct and tested, and the step-revision/fixture/snapshot bookkeeping is fully and correctly satisfied. The defects below are precision and bookkeeping, but three of them are direct misses against the subspec's own text or a ticked acceptance criterion, so they must be closed before this is ready.

## Must fix

### 1. Bring all four PR-narrative entries in `v2/docs/v1-behaviors.md` into line (highest confidence)

Only the two *generation* entries currently carry the sentinel-extraction language. The two *rewrite/regeneration* entries still describe whole-stdout/"regenerate when empty" behavior with no mention of sentinels or fallback — yet both rewrite paths route narrative regeneration through the same `generatePrDescription` and therefore through the new extraction. The subspec's `## Documentation updates` section explicitly requires updating **all four** PR-narrative entries (patch draft-PR generation, patch PR-body rewrite/regeneration, plan generation, plan PR-body rewrite/regeneration) "keeping the v1 parity baseline accurate for both first-generation and rewrite paths." Required outcome: the two rewrite entries must record that regeneration now goes through sentinel-delimited extraction, and (per item 2 below) that a `null` regeneration result preserves the prior machine narrative rather than emptying it.

### 2. Reconcile the null-path body-assembly acceptance criterion and docs with actual rewrite behavior

The acceptance criterion asserting that, on a `null` return, "patch mode assembles a header-only PR body … and plan mode assembles a body with no narrative section" is true only on **first generation**. On the rewrite path, a `null` regeneration result deliberately preserves the prior machine-owned narrative (it is not cleared to header-only). The code behavior is acceptable and arguably correct — a transient bad regeneration should not destroy a previously-good narrative, and no preamble can leak because nothing new is written — but the criterion and the docs overstate the contract by not distinguishing the two paths. Required outcome: scope the "header-only / no narrative on `null`" claim to the first-generation path, and explicitly state that on regeneration a `null` result preserves the existing machine narrative. This must be coherent with the documentation updates in item 1.

### 3. Add the end-to-end null-path body-assembly assertion that the criterion promises

The acceptance criterion above is worded to grade "the observable end-to-end body outcome," and the original symptom this work targets (conversational preamble appearing in a published PR body) lives in body assembly, one layer above the extractor. Every test added for that criterion asserts only `generatePrDescription`'s return value in isolation; the pre-existing body-assembly tests hand-pass `null` and predate this change. A regression that returns `null` correctly but mis-assembles the body would pass every current test. Required outcome: add at least one test, for each mode's first-generation path, that drives agent stdout containing preamble (and/or malformed sentinels) through `generatePrDescription` into the body-assembly path and asserts the assembled body is header-only (patch) / has no narrative section (plan) with no leaked preamble — grading the symptom the criterion names, not just the extractor.

## Should fix (low effort, avoidable churn/robustness)

### 4. Remove the dead test helpers

Both test files define a parameterized `_createMockAgent` factory that is never called; every test builds its agent inline. The leading underscore silences the unused-symbol lint while preserving dead code. Required outcome: delete both unused helpers rather than underscore-renaming them (AGENTS.md: keep changes minimal).

### 5. Record the echoed-example residual risk in the subspec

The shared fragment now embeds a sentinel-wrapped *template* whose body literally contains `Decisions:` and placeholder angle-bracket text. A weak model that echoes the example verbatim produces a well-delimited block that passes the `Decisions:` substring gate, leaking placeholder text into the narrative. This is strictly less severe than the bug being fixed (obviously-broken placeholder text vs. plausible preamble), and defending against it would require exactly the heuristic the spec consciously rules out. Required outcome: record this as an accepted residual risk (one line in the subspec's decisions) so the new failure surface is acknowledged rather than silent. Do not add a guard or test for it.

### 6. Revert the gratuitous re-indentation in `v1/docs/worktrees-and-commits.md`

Only the prose paragraph describing the narrative contract needed editing for the sentinel change; the fenced code block and its marker lines were also re-indented (3-space → 4-space leading), needlessly enlarging the diff. It will most likely render correctly, so this is cosmetic, but the indentation change should be reverted so the diff touches only the paragraph that actually changed.

## Note, do not block

- An out-of-scope unused-import removal (`existsSync`) rides along in a test file outside the subspec's declared scope. Harmless, but either drop it from this change or note it.
- No test exercises the multiple-opening-sentinel disambiguation ("first opening → next closing") that the implementation handles. Adding one is cheap regression insurance but is not required for this pass.

The single-subspec framing remains acceptable; the genuine gaps cluster in the rewrite-path documentation/contract (items 1–2) and the missing end-to-end assertion (item 3) — the same items the prior review flagged and that were ticked without being fully closed.