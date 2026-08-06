# Adjudicator verdict — pipeline-stage-settlement-honesty

Required refinements before implement:

## 1. Align adopt-path test contract across intent and subspec 00

`intent.md` still requires cross-process coverage through the literal `waitForWorkflowEntryRun` call stack; subspec 00 pins repair at settlement and exercises adopt via a `wait` primitive that mirrors rollup semantics (no in-flight promise; durable non-terminal entry run). These cannot both be authoritative.

**Outcome:** One contract everywhere — either intent AC matches subspec 00’s mirror-primitive + adopt path, or a new subspec owns literal `waitForWorkflowEntryRun` integration. Do not leave conflicting ACs.

**Rationale:** Failing-test ACs must name tests that fail baseline and pass after fix; ambiguous surface ownership strands implementers and violates atomic subspec boundaries.

---

## 2. Fix or relocate stage failure-mirroring acceptance

Subspec 02 pins `pipeline-execution.test.ts` — `"stage failureDetail mirrors owning run operator error for completion_commit_failed"` against a **settled** failed entry run, but terminal `failureDetail` for entry-run settlement is written in `pipeline-stage-dispatch.ts`, and dispatch already mirrors `composeRunOperatorError` when the run is terminal. The observed `harness_failure` / `stop` symptom on a **live** entry run is addressed by subspec 00’s liveness deferral (`composeRunOperatorError` returns `undefined` for non-terminal runs).

**Outcome:** Either (a) rewrite the mirroring AC to pin a scenario that fails baseline today — e.g. deferred settlement followed by re-settlement after the entry run actually terminals, asserting operator error shape on the terminal patch — with the owning subspec matching the writer surface; or (b) drop the mirroring slice from subspec 02 and cover re-settlement mirroring in subspec 00. Subspec 02 must not ship an AC that passes on baseline without behavior change.

**Rationale:** Spec guidance requires every runtime-behavior subspec to carry a failing-test AC; a green-on-baseline mirroring test is a spec defect.

---

## 3. Pin re-settlement after `settlement_deferred`

Deferred settlement leaves the stage `running` with visible `failureDetail` but does not state what triggers a later settlement attempt.

**Outcome:** Document (and preferably test) that existing adopt/continue/recovery paths re-attempt settlement when the linked entry run is no longer live — e.g. `continuePipeline`, `adoptRunningWorkflowStage`, refused admission adopt, `pipeline_resume`. A deferred → terminal-settle test closes the loop.

**Rationale:** Intent rules out silent forever-`running`; without a named retry seam, operators and implementers cannot verify the deferred state is transient.

---

## 4. Define retarget metadata contract

ACs require recording `requestedBase` and `resolvedBase` on the stage artifact or `failureDetail` but do not define shape, nesting, or success-vs-failure placement. `PipelineStageArtifact` has no base fields today.

**Outcome:** Subspec 01 must state the durable fields (names, structure, where they land on success artifact vs publication failure `failureDetail`) so “recorded” is verifiable.

**Rationale:** Harness specs may name structure when it is the contract; unverifiable “recorded” ACs block completion.

---

## 5. Scope retarget to the full publication chain

Retargeting only at `gh pr create` risks body refresh, confirm/view base checks, and summary derivation still targeting the absent plan branch.

**Outcome:** Subspec 01 must require resolved base flows through the entire publication attempt for implement-stage PR creation, and decide whether durable run `specRef` (or equivalent) is updated when retarget occurs.

**Rationale:** Partial retarget fixes the reported failure mode while leaving inconsistent publication behavior; one operator-visible outcome needs one resolved base for the whole chain.

---

## 6. Add explicit preservation AC for unchanged base (subspec 01)

Decisions and task checklist require unchanged base when the requested ref exists on `origin`, but `## Acceptance criteria` has no dedicated checkbox — only the retarget test.

**Outcome:** An explicit AC (dedicated test or clearly scoped assertion) that `branchExistsOnOriginAsync` true preserves the requested `--base`.

**Rationale:** Prevents always-retarget regressions; preservation ACs should cite the test per spec guidance.

---

## 7. Tighten the live-run terminalization invariant

“No `endedAt` equal to `startedAt` while entry run is live” is a narrow proxy; terminal patches with `endedAt > startedAt` on live runs would still satisfy it.

**Outcome:** Replace or supplement with the behavioral invariant subspec 00 already tests: no `failed`/`succeeded` terminal patch while `isLiveEntryRun` — in intent AC and any global criteria.

**Rationale:** AC should match the actual bug (premature terminalization), not a timestamp artifact.

---

## 8. Clarify subspec 02 prerequisites and scope

Prerequisite on subspec 01 is weak for mirroring (01 removes the primary `completion_commit_failed` reproduction chain). Subspec 02 bundles guard deletion with a mirroring AC whose baseline failure is uncertain.

**Outcome:** If mirroring stays in 02, define an independent failing scenario and drop or reword the 01 prerequisite to “shared dispatch surface” only where merge-conflict pragmatism applies. If mirroring moves to 00, narrow 02 to guard deletion + stacked-PR docs with ACs that match that scope. If mirroring and guard deletion cannot share one failing-test surface, split into independently testable subspecs linked from `index.md`, each owning its tasks and ACs exactly once.

**Rationale:** Atomic subspecs need independent failing tests and honest dependencies; combined slices that obscure baseline failure violate reviewability.

---

## 9. Documentation completeness (minimum)

Subspec doc tasks should explicitly cover:

- Re-settlement trigger after `settlement_deferred` (ties to #3)
- `daemon-host.md` reconciliation of the “never leave `running` on non-success settlement” wording **and** the `paused` rollup bullet, plus parity for other non-terminal live statuses (e.g. `budget-soft-stopped`)
- Operator-runbook note that `ls-remote` failure treats the base as absent and may retarget to repository base even when the branch still exists locally
- Whether `pipeline list` surfaces deferred `failureDetail` on `running` rows as-is

**Rationale:** Intent documentation updates and operator visibility decisions are part of the shipped contract; gaps leave behavior undefined for the single operator.

---

## 10. `@mutate` directive anchors (low severity, implement-blocking if wrong)

Mutation-checkpoint ACs name tests but not stable directive lines. Spec guidance expects linked `// @mutate` directives with unique anchors.

**Outcome:** Add directive sketches in subspec 00 and 01 task checklists when implement-time anchors are knowable (e.g. the `isLiveEntryRun` guard in `applyEntryRunSettlement`, the base-existence check before `gh pr create`).

**Rationale:** Bad or missing anchors block harness completion on mutation criteria.

---

## Upheld without required spec change

- Settlement-first repair at `applyEntryRunSettlement` vs `waitForWorkflowEntryRun` source fix — recorded decision is sound.
- `failWorkflowStageAt` live-link guard deletion — correct; sibling guards in advance catch/stranded paths remain intentional.
- `settlement_deferred` schema separate from operator-error schema — intentional for non-terminal visibility.
- Success-path terminalization on `rollupStatus === "completed"` while row reads live — explicit scoped tradeoff.
- Fail-closed retarget on `ls-remote` error — explicit decision; doc note in #9 suffices.
- Per-subspec verification split (`test:integration:v2` on 01/02 only) — standard index-routed pattern.
- Subspec 01 coupling retarget + metadata persistence — one operator-visible behavior; split not required if #4–#6 are addressed.

---

**Summary:** The three-way split and settlement-first ordering are sound. Required work concentrates on contract alignment (adopt test, mirroring AC baseline, retarget metadata and publication scope), closing the deferred-settlement retry loop, explicit base-preservation AC, and tightening the live-run invariant. Subspec 02 needs the most revision — its mirroring slice is the highest risk of a no-op implement run.