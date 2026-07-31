# Verdict: required refinements

## Subspec 00 — Resolve stage fan-out

1. **Pin the resolution API contract.** State that `resolveStageWorkflowSteps` returns multiple results (one per downstream input) when the prior splitting artifact carries `downstreamInputs`, and that production caller fan-out wiring lands in subspec 01. Without this, subspec 00’s acceptance criteria and deferred caller work conflict.

2. **Clarify when fan-out applies.** Fan-out triggers only on the first chained stage after a splitting artifact (prior artifact has `downstreamInputs` with length ≥ 2). Later stages (e.g., implement after per-branch plan) resolve from the branch-local preceding artifact and do not re-iterate intent `downstreamInputs`. Add a preservation acceptance criterion that single-file plan handoff still yields one resolution.

3. **Add a guard-inversion acceptance criterion for missing downstream files.** When a listed `downstreamInputs` path is absent, resolution fails without falling back to directory `specPath`. Task checklist already names this; spec guidance requires a matching failing-test AC with inversion.

4. **Decide `downstreamInputs` length 1.** Pin behavior when the array is present but length is 1 (treat as single resolution or reject as invalid) so implementers do not guess.

## Subspec 01 — Execute branch fan-out

5. **Pin default-row reconciliation at fan-out admission.** After a splitting intent succeeds, pre-admitted `default` rows for downstream stages must not cause spurious dispatch, double execution, or ambiguous state once per-branch rows exist. This is execution-layer work; deferring it to the operator-CLI sibling intent is incorrect. Add an acceptance criterion proving no stray `default` plan/implement activity after fan-out.

6. **Pin branch-scoped continuation semantics.** The spec’s mixed success/failure contract requires explicit decisions that:
   - `runPipeline` does not halt the whole pipeline when one branch fails while sibling branch rows remain actionable
   - `skipRemainingStages` applies only within one `branchKey`, not across all rows at a position
   - `continuePipeline` / `resumePipeline` behavior is defined for partial fan-out (per-branch vs aggregate)

7. **Pin RPC gate targeting by branch.** `pipeline_approve` and `pipeline_reject` must accept `branchKey` and refuse (or otherwise prevent cross-branch leakage) when it is omitted and multiple branch rows exist at the same stage. The existing gate-isolation AC cannot be satisfied without this wire contract.

8. **Pin an observable for aggregate failure naming.** Mixed-outcome acceptance criteria require the terminal aggregate to name failed/rejected branches. Pin where that naming appears (e.g., pipeline- or stage-level `failureDetail` includes the `branchKey`) so “names” is enforceable, not merely `state !== "succeeded"`.

9. **Add rejection continuation acceptance criterion.** Mirror the mixed failure case: branch A rejected, branch B reaches terminal success, aggregate is non-`succeeded` and names the rejected branch, without aborting branch B.

10. **Pin branch-scoped artifact isolation.** Stage artifacts must not be last-write-wins per `stageId` only; branch B’s plan artifact must not overwrite branch A’s. Add an acceptance criterion or decision that makes per-branch artifact lookup explicit—required for subspec 02’s real worktree path.

11. **Explicitly defer multi-branch terminal publication.** State that terminal publication when multiple implement branches succeed is out of scope for this spec (unchanged / deferred until a definition needs it), so implementers do not silently pick first-wins behavior.

12. **Acknowledge intentional scope shrink from the seed intent.** Operator `pipeline list` / `wait` projection, CLI syntax, and operator-runbook updates belong in the sibling `pipeline-branch-operator-cli` intent; this spec owns daemon execution and RPC gate scoping only.

## Subspec 02 — Two-ready-intent pipeline e2e

13. **Pin branch-aware harness expectations.** The e2e case must assert per-stage dispatch counts of 2 and update or replace single-branch helpers (`fastStageStatusVector`, `dispatchCounts`, row lookup by `stageId` only) so a collapse-to-one-branch regression fails observably—not only at final success assertion.

## Cross-cutting

14. **Documentation task alignment.** When updating `v2/docs/daemon-host.md`, correct the stale slug reference to match this intent name.

---

## Rationale (summary)

Prerequisites are satisfied; the gap is consumption and execution contract completeness. Subspec sequencing (resolve → execute → e2e) is sound. Refinements above close blockers where unit tests could pass while production paths leak gates, double-dispatch `default` rows, halt siblings on one failure, or overwrite branch artifacts. They align with spec guidance: behavioral ACs must be agent-verifiable, new runtime behavior needs failing-test/inversion guards, and scope splits from the seed intent should be explicit rather than appearing as accidental omission.

**No subspec split required** if subspec 01 absorbs items 5–12 as decisions and ACs; the coupled paths share one module boundary and are not independently shippable without the same decisions.