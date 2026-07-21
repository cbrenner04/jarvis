## Verdict: refinements required before merge

The spec’s core direction is sound—primary `intent` should adopt the posture `intent-reviewed` already had, collapse the duplicate default path, preserve `--review-passes 0` opt-out, and leave plan defaults to the sibling. The following gaps must be closed so implementers and doc readers are not misled about scope, behavior, or verification.

### 1. Correct the product framing (drop false v1 parity)

**Outcome:** Documentation tasks and any acceptance criteria must describe this as a **v2 consolidation**: bare `intent` matches former `intent-reviewed` (one light pass), with the prior zero-pass default recorded as a **v2 behavior change**. Do not claim v1 intent review-by-default parity—v1 intent is split-only with human PR review; agent review is v2 additive and v1 review-by-default applies to plan, not intent.

**Rationale:** False parity language will mislead operators and reviewers; it also conflicts with `v1-behaviors.md` as written.

### 2. Surface the full `reviewBehavior` default change in Decisions

**Outcome:** Decisions must state explicitly that omitted `reviewBehavior` defaults to `light` for **all** intent runs with `passes > 0`, not only the new `passes ?? 1` case. That replaces the current `?? "debate"` fallback everywhere on intent—including multi-pass runs (e.g. `reviewPasses: 2` with omitted behavior runs light cycles, not debate).

**Rationale:** Acceptance criterion 4 already encodes this wider semantic shift, but Decisions read like “move alias defaults only.” That mismatch is the highest implementer risk.

### 3. Record supersession and migration posture

**Outcome:** Add a decision or documentation requirement that this **supersedes** the split-only-primary `intent` posture from prior work: bare `intent` now matches former `intent-reviewed`; `intent-reviewed` becomes behaviorally redundant (alias/migration hint may need updating). Operator-facing docs should note the breaking change for scripts or automation that relied on instant split-only completion and point to `--review-passes 0` opt-out.

**Rationale:** The change intentionally reverses landed prior decisions; the spec must say so explicitly, not only describe the new default.

### 4. Name the failing test for new behavior (spec guidance)

**Outcome:** The acceptance criterion that pins default review-on behavior must name a **concrete test identifier** (new or renamed) that fails against current `reviewPasses ?? 0` / `reviewBehavior ?? "debate"` and passes after implementation—not “default-review case” or equivalent vague wording.

**Rationale:** Failing-test AC requirement for runtime-behavior subspecs.

### 5. Replace paraphrased preservation AC with test citations

**Outcome:** The preservation acceptance criterion must cite pinning tests by file and test name (e.g. table-driven routing cases, landing/resume cases in `workflow-runner.test.ts`), not paraphrase “routing, landing, resume stay green.” Include the test that currently expects split-only default (`"builds file and inline seeds with stable PR titles"`) as an explicitly named update or split—not buried under a generic preservation line.

**Rationale:** Spec guidance: refactor/preservation ACs cite the test; paraphrasing hides known breakages.

### 6. Pin known test rewrites in tasks or acceptance criteria

**Outcome:** Tasks or ACs must name tests that **must change** with the new defaults, including at minimum:
- `"omits review by default and for zero passes"` (split/rename: default → two steps; zero → still one)
- `"builds file and inline seeds with stable PR titles"` (length/expectation update)
- `"selects light or debate review for positive passes"` (omitted behavior with positive passes → light)

**Rationale:** Task checklist says “fix regressions” but leaves implementers to discover breakages; ACs should make the contract auditable.

### 7. Cover omitted passes + explicit debate behavior

**Outcome:** Add acceptance coverage for omitted `reviewPasses` with explicit `reviewBehavior: "debate"` (operator path: `--review-behavior debate` without `--review-passes`) yielding one `review-debate` step with `maxCycles: 1`.

**Rationale:** Real CLI path not fully covered by current AC 4, which only addresses explicit behavior with unspecified pass sourcing.

### 8. Expand documentation scope and verify consistency

**Outcome:** Documentation acceptance criteria must require **cross-section consistency**, not single-paragraph updates, for:
- **`v2/docs/workflow-runner.md`** — all sections that still describe split-only `intent` vs distinct `intent-reviewed`
- **`v2/docs/operator-runbook.md`** — preset table, canonical examples, and the telemetry paragraph that assumes most intent runs skip review (revise or mark historical); reflect review-on-by-default and `--review-passes 0` opt-out
- **`v2/docs/v1-behaviors.md`** — rewrite the intent review bullet (and any overview text that implies all presets omit review when passes are omitted) to state new default, opt-out, and prior zero-pass behavior—**without** v1 intent parity claims

**Rationale:** Listed doc files are named but ACs do not guard against partial edits leaving contradictions; advocate-validated stale sections exist today.

### 9. Clarify `intent-reviewed` zero-pass equivalence

**Outcome:** Acceptance criteria should confirm `buildReviewedIntentWorkflowSteps` with `reviewPasses: 0` remains split-only (same as primary builder), so delegate collapse does not regress the zero-pass path.

**Rationale:** Partially covered by AC 2/3 but worth explicit pinning once the wrapper loses its own defaults.

---

**Not required for merge** (implementation may still choose): dedicated CLI `intent` vs `intent-reviewed` step-equivalence AC; `workflow.test.ts` migration-hint update; `reviewPasses: 0` + `reviewBehavior: "light"` edge pin; standalone cost/latency rationale beyond a brief runbook opt-out note. Builder-level tests remain the primary contract for step composition.
