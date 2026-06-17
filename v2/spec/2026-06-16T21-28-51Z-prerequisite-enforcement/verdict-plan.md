I'll ground myself in the actual code referenced in this review before issuing a verdict.Now let me verify the plan handler flow (draft blocker short-circuiting review) and the snapshot test pins.Now let me verify the `v1-behaviors.md` and `plan-mode.md` lines, plus the no-prerequisites convention in the intent-command fixtures.The `intent-command.test.ts` path didn't match. Let me find the actual test file and verify the no-prerequisites convention.I have the key evidence. The `none` literal in plan-command fixtures vs. the authoritative "empty body" convention in the intent-split prompt is confirmed. Let me verify the intent-split prompt source itself to confirm the canonical no-prerequisites form, and check the spec-guidance line on Prerequisites authoring.All key claims are now grounded against source. The evidence confirms:

- `validateDraftOutput` reorder is real and load-bearing (draft.ts:291 vs :303)
- The blocker check already wins over the subspec check today (monotonic toward "blocker wins")
- `isValidIntentModification` (draft.ts:320-326) fails the whole draft if `intent.md` is touched beyond a `## Blocker` append — the M4 hazard is real
- Draft blocker returns 1 at plan.ts:1083, before review at :1101 — AC3 is structurally guaranteed
- Revision is `7` in two places (rendered-snapshots.test.ts:38 and the derived `draftKey` at :44)
- `plan-mode.md:96` says "not enforced **at plan entry**" — stays true after a draft-phase gate; M8 contradiction hazard is real
- Canonical no-prereq form is **empty body** (intent-split.ts:63); `none` appears only in stale plan-entry fixtures (plan-command.test.ts:47,218)

Issuing the verdict.

---

# Verdict — Required Refinements

The spec's core design is sound: a draft-agent prerequisite gate that reads repo files, fails closed, and reuses the existing `## Blocker` plumbing, paired with a `validateDraftOutput` reorder so a no-`index.md` blocker surfaces as a blocker rather than an index error. The `validateDraftOutput` reorder diagnosis is correct and load-bearing. The following refinements are required before this spec is ready.

## Required

1. **Forbid the agent from recording its prerequisite judgment in `intent.md` on the pass path.** `validateDraftOutput` fails the entire draft if `intent.md` is modified by anything other than appending `## Blocker`. The gate instructs the agent to judge prerequisites first; an agent that writes "prerequisites confirmed: X, Y" into `intent.md` before drafting would fail integrity validation and surface as a confusing "intent.md was modified" error instead of a clean draft. The gate text must state that the prerequisite judgment is internal reasoning — on a pass, nothing is written to `intent.md`; only a genuine `## Blocker` may be appended, and only on failure.

2. **Bound "legibly present" with a rubric, or record it as an explicit deferral.** The entire gate hinges on "legibly present" / "cannot cleanly confirm," yet the spec gives the agent no rubric for what evidence counts (committed code? a passing test? a doc bullet? a named symbol?). Because the gate is fail-closed, an under-specified rubric biases toward false-negatives that block shippable work, and two runs of the same intent could disagree. Either add a short operational rubric to the gate text (e.g., a prerequisite is confirmed only when its behavior is observable in committed code, tests, or docs in the repo; prose describing future work does not count), or record an explicit `Deferred to first consumer` entry for the rubric with the fail-closed default stated. The existing deferral covers only a machine-readable per-behavior *format*, not the judgment rubric itself.

3. **Scope the doc updates so draft-phase enforcement does not falsify the still-true "not enforced at plan entry" statement.** `plan-mode.md` currently states prerequisites "are not validated or enforced **at plan entry**" — and this remains true after the change, because enforcement moves to the *draft* phase, not plan entry (entry validation still only checks the section is present). The spec's doc-updates section must make the enforcement explicitly *draft-phase*: keep the plan-entry statement accurate (qualify it as enforced later by the draft-agent gate, see Phase 1), and scope the `v1-behaviors.md` edit to the draft/review-prompt-context bullet only — not the separate plan-entry-validation bullet. A blanket "not enforced" → "enforced" replacement would create a false statement and rot the v1 parity baseline (a hard requirement per repo conventions).

4. **Record the intent-integrity-bypass-on-blocker behavior as an explicit decision.** Today a blocker already bypasses `intent.md` frontmatter/prose integrity validation (the blocker check returns early, before integrity validation). The spec is deliberately changing validation ordering and should state the consequence: a gate blocker bypasses intent-integrity validation, same as any agent blocker today — accepted; the write-boundary checks still revert out-of-bounds files. State it in one line so the behavior is not silent.

5. **Spell out the snapshot revision bump precisely.** The rendered draft prompt is `revision: 7`; the snapshot test pins it in the revision assertion and derives the fixture filename from that same value. The task currently says "update the revision pin" (singular) and writes `@r<new>` without naming the number. Specify: bump to revision `8`, regenerate the `@r8` rendered-draft fixture, and update the single revision assertion to `8` (the fixture-name key derives automatically). A bump that updates the assertion but not the fixture (or vice-versa) fails the suite.

## Cheap precision adds (fold in while refining)

6. **Name the gate's input as the intent's `## Prerequisites` section, and treat an empty-or-`none` body as no prerequisites.** The canonical no-prerequisites form is an **empty** `## Prerequisites` body (the intent-split prompt instructs "leave the body empty when there are no prerequisites"). Some existing entry-validation fixtures still use a bareword `none` body. The gate text should (a) name its input as the `## Prerequisites` section of the intent data (not arbitrary intent prose, to keep the prompt's data-firewall boundary clean), and (b) treat a body that is empty *or* a single bareword like `none` as "no prerequisites → skip the gate." This also clarifies the spec's "empty `## Prerequisites` section skips the gate" matches the real authoring convention.

7. **Cite the structural guarantees the acceptance criteria rely on.** Two ACs assert outcomes that are already guaranteed by existing control flow; cite them so they read as guarantees rather than hopes: (a) "a failed gate runs no review passes" is guaranteed by the draft-blocker handler returning before the review phase in the plan command; (b) the reorder must win over **both** the index-exists check and the subspec-count check, so a partial-file gate failure and a zero-file gate failure behave identically.

8. **Clarify how the agent-judgment acceptance criteria are tested.** The criteria for satisfied / unconfirmable / empty prerequisites read as if the agent's *judgment* is being graded. Make explicit that these are validated via scripted fake-agent output driving the stop/commit/stderr plumbing (the established plan-mode test pattern), while the gate's verdict itself is agent judgment asserted only as prompt text. This prevents an implementer from expecting a model-in-the-loop test.

## No change required

Single-subspec cohesion is correct — the prompt gate and the `validateDraftOutput` reorder are two halves of one mechanism (the reorder only matters because the gate writes a blocker without an index), and the reorder has no independently observable behavior to split out. Naming `validateDraftOutput` in acceptance criteria is permitted (harness subspec, internal symbol is the contract). The `repo:` line is correct.