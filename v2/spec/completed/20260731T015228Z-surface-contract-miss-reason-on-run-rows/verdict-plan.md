# Verdict: required refinements

## 1. Copy prerequisite into the subspec

Add a `## Prerequisites` section to `00-project-contract-miss-detail-on-run-rows.md` stating that plan-draft normalizer rejection already propagates its message through `failureReason` / `contract_miss_detail.failureReason`. Implement agents read the active subspec, not `intent.md`; without this, a regression in the write loop would surface as a confusing projection failure.

## 2. Pin the composition seam and guard location

The decision ledger must state unambiguously that `contractMissDetail` enrichment runs in the **shared list/wait composition path** (the same path that produces `RunOperatorError` for both surfaces), not as divergent daemon-only post-processing. AC #4 must invert **that** guard—not a vague “daemon guard”—so inversion proves the field is absent when enrichment is disabled. This closes the risk of two implementations (composer vs. daemon) that satisfy checklist tasks but violate the “one composer, one tail rule” decision.

## 3. Add a negative-path preservation AC for the new enrichment path

AC #3 correctly cites the existing `loop_finished`-only test, but that test never exercises `contract_miss_detail` events. Add an acceptance criterion (or extend AC #3 with an explicit second anchor) requiring a test where the log tail contains `contract_miss_detail` **without** `failureReason` and the composed error keeps today’s shape (no `contractMissDetail`). Without this, a broken guard that always attaches detail or attaches on empty `failureReason` could pass AC #3 and the positive daemon tests while violating the “only when `failureReason` is present” decision.

## 4. Align tail-selection wording across intent and subspec

Intent says “terminal `contract_miss_detail.failureReason`”; the subspec says “chronologically last.” Align intent to **chronologically last** (last-wins), matching existing log-tail conventions and reprompt/resume cases where multiple detail events may exist.

## 5. Clarify what daemon integration tests must prove

ACs #1–#2 should state that “plan-draft normalizer” names the motivating producer; daemon regressions may inject persisted `contract_miss_detail` + `loop_finished` log rows with the same `failureReason` text rather than driving the full write loop. The subspec’s contract is **persisted log → list/wait row projection**; end-to-end write-loop coverage is already owned by the prerequisite and would duplicate layers without strengthening the projection ACs.

## 6. Require list/wait parity in one regression

Tighten AC #2 so the list assertion is not optional or wait-only: the same settled-run regression must assert `error.contractMissDetail` on **both** `wait` and `list`, matching the established combined-test pattern used for comparable row fields (e.g. `surviving_mutation_failed`).

## 7. Align task checklist with acceptance criteria on inversion scope

The task checklist promises unit-level guard inversion; AC #4 only names the first two daemon tests. Reconcile so expectations match—either drop unit inversion from the checklist or add a unit inversion AC. Given AC #4’s daemon focus, the checklist should not promise unit inversion it does not verify.

## 8. Document composition API boundary at decision level

Add one decision-ledger or task-checklist outcome stating how log records reach composition (e.g. optional log tail input to the shared composer vs. a single documented post-compose enricher invoked from both list and wait). No implementation prescription beyond: one path, one rule, both surfaces. This removes implementer ambiguity left open by “wire log-tail lookup in daemon list/wait.”

## 9. Document omit-when-tail-unavailable behavior

In documentation updates (or a brief ledger line), state that when log tail cannot be read (store-only / no `logReader`), `contractMissDetail` is omitted—same omission pattern as other log-sourced optional fields. No new AC required unless the spec wants an explicit store-only negative test.

---

**Not required (acknowledged scope):** split the subspec; add a dedicated positive unit-test AC (daemon failing-test ACs suffice); workflow-entry owner rollup for sibling `contract_miss` runs; recovery-string copy changes; wire-size bounds; TUI rendering.

**Rationale summary:** The spec is correctly scoped and implementable. Required refinements close gaps where preservation could false-green, inversion could target the wrong seam, or implementers could diverge list/wait paths or over-build daemon tests—without changing the intent’s product outcome.