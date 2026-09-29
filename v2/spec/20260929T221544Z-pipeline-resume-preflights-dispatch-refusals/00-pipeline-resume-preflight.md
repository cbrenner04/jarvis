# 00 — `pipeline resume` preflights re-dispatch refusals

## Problem

`pipeline_resume` (`v2/src/daemon/daemon-pipeline-handlers.ts`) returns `resumed` with `detachContinuation: true`; the detached re-dispatch (`advanceWorkflowStage` in `v2/src/daemon/pipeline-execution.ts`) then refuses and the stage settles `failed`, visible only as a `stage-failed` incident. Two refusal sites: the reopened-plan operator `## Blocker` check (`refuseReopenedPlanOperatorBlockerLocal` / `WithGit`) and `maybeResetStaleWorkspace` (`v2/src/commands/stale-reset-workspace.ts`, gates in `resetStaleWorkspace`, `v2/src/commands/cleanup.ts`).

## Decisions

- Admission probes the stage the resume would re-dispatch: the same stage resolution and steps `advanceWorkflowStage` uses, not a separately derived build. Probe runs only when that stage's workflow is in `STALE_RESET_WORKFLOWS` and its build carries a git write step (the condition `maybeResetStaleWorkspace` already applies); other stages admit unchanged.
- The probe reuses the dispatch checks in dispatch order: the reopened-plan `## Blocker` check first, then `maybeResetStaleWorkspace` with a probe flag; no parallel gate copy — a copied gate drifts from dispatch.
- The probe builds reset options through `buildResetStaleWorkspaceOptions` from the same resume flags dispatch uses (`reopenedStageResetFlags`), so every override and skip flag dispatch honors (`resetDespiteDirty`, `resetDespiteLandedCriteria`, `disposableLane`, `resetDespiteContinuable`) also applies at admission.
- Probe mode is non-mutating: it evaluates the dirty-worktree, not-descended-from-base, landed-criteria-drift, forged-tick, and unlanded-commit gates, which all run before any mutation in `resetStaleWorkspace`, and returns before `rebaseWorktreeOntoBase` and `performAbandonmentSteps`. It never fetches, rebases, resets, or destroys artifacts.
- Rebase-conflict refusal is out of probe scope — it can only be observed by rebasing; it still settles `failed` at dispatch.
- `worktree_claimed` is excluded: the resuming pipeline's own claim would self-refuse at admission. Live-held and open-PR gates (which precede the claim check) run as in dispatch.
- Probe returns the refusal as structured data (`{ refused: true, message }`) instead of writing to `io.stderr`. `message` is the exact line dispatch prints: `Error: Cannot re-run incomplete spec: <reason>` for stale-reset refusals, `Error: Cannot redraft failed plan stage: <blocker>` for the operator blocker; the admission RPC error frame carries it verbatim, so a later incident reads the same.
- A refusal returns an RPC error frame before `resumePipeline` dispatches; the CLI's existing RpcError→stderr path prints it and exits non-zero. No stage is dispatched.
- The dispatch-time gates are unchanged: a refusal that appears between admission and dispatch still settles the stage `failed`; the dispatch check is not removed as redundant.

## Acceptance criteria

- [x] A new daemon-handler test drives `pipeline_resume` against real git fixtures whose re-dispatch would be refused by, separately, a dirty worktree, a lane not descended from base, landed-criteria drift, and an unresolved `## Blocker` on a reopened plan stage; each returns an RPC error frame carrying the exact dispatch refusal line and dispatches no stage; fails against the pre-fix `resumed` outcome.
- [x] A CLI-level test shows `jarvis pipeline resume` on the dirty-worktree case prints the reason on stderr and exits non-zero; fails against the pre-fix exit 0.
- [x] Tests show `resetDespiteDirty` on the dirty-worktree case and `resetDespiteLandedCriteria` on the drift case each still admit (`resumed`).
- [x] The probe leaves worktree contents, branch, and HEAD unchanged (asserted in the dirty, not-descended, and rebase-eligible-clean-lane cases).
- [x] A test shows a clean, rebase-eligible lane admits (`resumed`) and the probe performs no rebase.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — `pipeline resume` refusals print their reason and exit non-zero; no stage is dispatched.
- `v2/docs/daemon-host.md` — `pipeline_resume` admission returns pre-dispatch refusals as RPC error frames; rebase conflicts and `worktree_claimed` are still dispatch-time only.
- `v2/docs/v1-behaviors.md` — record the changed pipeline-resume admission behavior.
