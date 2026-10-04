# Adjudicator Verdict: fan-out-concurrent-sibling-dispatch

Required refinements before the spec is merge-ready:

## 1. Align mutation checkpoints with the regression they prove

Subspec 01 parallelizes two dispatch sites (`advanceFanOutBranches` and `runPipeline` suffix walks) but pins `@mutate` only on the suffix loop. The primary concurrent-dispatch regression for sibling **plan** rows exercises `advanceFanOutBranches`, not the suffix loop. The spec must tie each `@mutate` checkpoint to the serial loop the named regression actually exercises — either by moving/adding the primary pin to `advanceFanOutBranches`, or by requiring two mutations (one per site) with each regression scoped to its path. Without this, a green mutation gate can miss the plan-dispatch bug the intent describes.

## 2. Name the failing-test anchors in acceptance criteria

Per spec guidance, runtime-behavior ACs must cite stable test names that fail pre-fix and pass post-fix.

- **Subspec 00:** The branch-scoped artifact AC must name the regression test (e.g., controlled populate order proving branch B's implement binds branch B's plan artifact, not branch A's). Prose-only behavior descriptions are insufficient.
- **Subspec 01:** The concurrent-dispatch AC must name the regression test and specify its fixture shape (deferred `wait` on one branch, mid-pipeline snapshot asserting the sibling reaches `running` before settle).

## 3. Specify the fan-out fixture for the concurrent-dispatch regression

Intent wording ("after intent-split approval") is ambiguous between gated pipeline (intent → approval → plan) and linear fan-out (branch admission at intent completion). The spec must pick a primary fixture for the core `worktree_claimed` false-positive regression and state whether `daemon-pipeline-approval.test.ts` needs new fan-out coverage or only must complete without unmocked store methods after parallelization. Linear fan-out is sufficient if the spec states that explicitly.

## 4. Restore the `worktree_claimed` qualifier in subspec 01

Intent AC distinguishes `failed` with `worktree_claimed` **naming another stage's invocation** while the stage's own entry run is still live. Subspec 01 drops that qualifier. Restore it so the regression targets the specific post-admission linkage false positive, not unrelated `worktree_claimed` shapes.

## 5. Fix subspec 00 verification scope

An "independently testable" subspec whose sole gate is `typecheck` can land with a broken `pipeline-stage-resolve.test.ts`. Subspec 00 must require running the relevant unit tests (at minimum `pipeline-stage-resolve.test.ts` / the named regression) in addition to `typecheck`. Full `test:integration:v2` can remain in subspec 01.

## 6. Replace or demote the weak preservation AC in subspec 00

`"branch plan artifacts coexist and resolve independently per branchKey"` asserts durable artifact fields after a full run — it does not exercise in-memory `stageArtifacts` during `resolveStageWorkflowSteps` / `findPrecedingWorkflowArtifact`, the seam subspec 00 changes. Drop or demote to informational context. Optionally add a preservation cite for an existing chained-resolution test in `pipeline-stage-resolve.test.ts` (including `chainedInputRoot` / ready-intent cases).

## 7. Clarify shared-map semantics across dispatch sites

Subspec 00 must state explicitly: concurrent `advanceFanOutBranches` may share one composite-keyed `stageArtifacts` map (sibling writes are disjoint); per-branch isolated maps are required only for suffix `runAuthoredStages` walks (no `sharedStageArtifacts` carry-forward). Without this, implementers may over-split or under-scope `advanceFanOutBranches`.

## 8. Address the `sharedStageArtifacts` removal gap

Subspec 00's resolve-focused regression may not prove that dropping `sharedStageArtifacts` from suffix walks is load-bearing. The spec must either add a mutation checkpoint or execution-level pin on that guard, or document why the branch-scoped read regression already fails when suffix walks share a map.

## 9. Reword the `daemon-pipeline-approval.test.ts` store AC

That file uses `openStateStore` (real SQL), not `fakeStore`. Reword to require every `StateStore` method invoked on the concurrent dispatch path is implemented in the test doubles/stores used by `pipeline-execution.test.ts` and `daemon-pipeline-approval.test.ts`, and clarify whether approval tests need new fan-out scenarios or only must complete without `undefined` handler surprises.

## 10. Make the test-migration checklist actionable in subspec 00

"Only where needed" is too vague for the `(stageId, branchKey)` key migration. Task checklist must explicitly call out updating `fanOutResolveStageStub`, shared test helpers, and `stageArtifacts.get("` usages in fan-out tests.

## 11. Specify the concurrent-regression harness shape in subspec 01

Task checklist must require: deferred `wait` on at least one branch's plan, `flushBackgroundRuns` (or equivalent mid-pipeline snapshot), assert sibling plan is `running` (or appears in dispatch log) before the deferred branch settles. Existing live-linkage tests model this pattern but subspec 01 does not require it.

## 12. State recovery/restart concurrency as out of scope

Subspec 01 scopes `runPipeline` suffix continuation and `advanceFanOutBranches`. Add an explicit out-of-scope line: recovery/restart branch walks (`recoverContinuablePipelines`, `resumePipeline`) may remain serial; this spec covers initial dispatch and in-flight continuation from those two sites only.

## 13. Documentation tasks must cover in-memory scoping and serial→concurrent change

Subspec 00 defers docs to 01 — acceptable if 01 explicitly documents **in-memory** branch-scoped artifact resolution (not only durable row semantics) and replaces any implicit serial-dispatch description with concurrent sibling dispatch in `daemon-host.md` § Branch fan-out execution and `v1-behaviors.md`.

---

## Rationale

The spec's architecture (subspec 00 → 01 ordering, branch-scoped keys, parallelizing both dispatch sites, PR #2555 constraints, live-entry-run prerequisites, dispatch-claim out of scope) is sound and needs no rethink. The gaps are **test-contract precision** (named tests, fixture choice, `@mutate` alignment, harness shape), **AC accuracy** (store wording, preservation cites, verification gates), and **boundary clarity** (shared vs per-branch maps, recovery out of scope). These refinements align with spec guidance on failing-test ACs, mutation checkpoints, refactor preservation cites, and independently testable subspecs.

## Not required

- Splitting subspec 01 (bundling is acceptable if the refinements above land).
- Composite key representation (implementation detail once a shared helper is tasked).
- New `test:integration:v2` scenario (full gate in 01 is sufficient).
- Durable admission claims (correctly out of scope).