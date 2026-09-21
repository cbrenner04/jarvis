# Resume reopens an interrupted stage

`pipeline resume` refuses every derived-`interrupted` pipeline with bare `pipeline_not_resumable` (`resumeDeferredRefusalApplies`, `v2/src/daemon/pipeline-execution.ts`). Make explicit resume reopen and dispatch the `interrupted` stage like `failed`, whole-pipeline and branch-scoped.

## Touched surfaces

- `v2/src/daemon/pipeline-execution.ts` — admission, reset construction, `BranchResumeReopenKind`.
- `v2/src/persistence/state-store.ts` — reopen of an `interrupted` source row.

## Decisions

- Scope is any `interrupted` stage row (`run kill --force` or orphan reconciliation); add no marker distinguishing them — no durable signal exists.
- Add a sibling `reopenInterruptedPipeline` on the state store (same transaction shape, source status `interrupted` → `pending`) and leave `reopenFailedPipeline` / `analyzeFailedPipelineReopenShape` untouched; `reopenFailedPipeline`'s other caller (`pipeline-stage-recovery.ts`) is therefore unaffected. Extending the failed shape analyzer is ruled out: its suffix rule requires `skipped` rows, while an interrupted stage's suffix is `pending`.
- Reopen resets only the interrupted row; suffix rows are left as-is.
- A reopened `interrupted` stage gets `reopenedStageReset` and passes the same `--reset-despite-dirty` / `--reset-despite-landed-criteria` gates as a reopened `failed` stage; `findFailedStageForReopen` / `buildReopenedStageReset` generalize to accept an `interrupted` row. A forced kill usually leaves a dirty worktree, so the gate must not be bypassed.
- Branch-scoped resume adds a new `BranchResumeReopenKind` `interrupted` (not folded into `failed`, since it calls the sibling reopen); `scanBranchSuffixForAdmission` admits an `interrupted` branch row with it.
- `branch_resume_required` listing is unchanged: it lists only `failed` plan-workflow branches, and derived `interrupted` takes precedence over the awaiting-approval state that emits it.
- `isPipelineContinuable` / `recoverContinuablePipelines` unchanged: restart never auto-continues `interrupted` — auto-continuing would undo a deliberate kill.
- An `interrupted` pipeline carrying a `running` stage keeps today's refusal in this subspec (named refusal lands in the running-stage subspec); settlement stays skipped for `interrupted` pipelines, and a non-live `running` sibling left by orphan reconciliation is still refused, not settled. The stale comment above `settledEntryRuns` ("refused outright below") is corrected to say settlement is skipped so a refusal leaves rows byte-identical.
- Kill-path fidelity: tests seed the `interrupted` row through `store.updateStage`, as the existing "resume still refuses an interrupted pipeline carrying an unsettled running stage" test does; resume reads only stage rows, and the kill path that writes them is a separate unit.

## Acceptance criteria

- [ ] A test in `v2/src/daemon/pipeline-execution.test.ts` seeds an `interrupted` stage row (store-driven, the state a `--force` kill leaves), then proves `pipeline resume` reopens and dispatches that stage; it fails against the pre-fix unconditional refusal.
- [ ] A test proves branch-scoped `pipeline resume <id> <branch>` reopens and dispatches an `interrupted` branch stage; it fails against the pre-fix code.
- [ ] A test proves resuming an `interrupted` stage with a dirty worktree refuses at the stale-reset gate without `resetDespiteDirty` and dispatches with it; it fails against the pre-fix code, which refuses before any gate.
- [ ] A test proves `recoverContinuablePipelines` leaves an `interrupted`-stage pipeline undispatched.
- [ ] `pipeline-execution.test.ts` "resume still refuses an interrupted pipeline carrying an unsettled running stage" stays green (unchanged, including its byte-identical `stages()` assertion).
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/pipeline-execution.md` — drop `interrupted` from the `pipeline_not_resumable` list (~line 190); document explicit resume of an `interrupted` stage (whole-pipeline and branch-scoped, same reset gates as `failed`) and that restart continuation does not auto-continue it.
- `v2/docs/operator-runbook.md` — replace "an `interrupted` pipeline refuses without settling anything" (~line 741) with the new resume behavior; an `interrupted` pipeline carrying a `running` stage still refuses.
- `v2/docs/v1-behaviors.md` — add a `[v2 behavior change]` entry beside the `pipeline resume` entry (~line 325): `interrupted` stages now resume instead of refusing `pipeline_not_resumable`. v1 had no pipelines.
