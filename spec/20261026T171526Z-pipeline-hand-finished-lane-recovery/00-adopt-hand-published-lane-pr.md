# 00 - Adopt a hand-published lane PR at chained implement

## Problem

When an implement lane is finished outside the pipeline (operator ticks the remaining criteria and publishes the lane branch by hand), `jarvis pipeline resume <id> <lane>` re-resolves the implement stage, the builder's completion gate (`validateImplementSpecTreeCompletion`) returns `implement.already_complete`, and `failWorkflowStageAt` settles the stage `failed`. The lane can never settle `succeeded`, so its PR is invisible to the pipeline and every chained dependent stays severed. Observed on conquer-hills pipeline `a7628b6e`, lane `repository-bootstrap` (PR cbrenner04/conquer-hills-jarvis#1).

## Decisions

- Applies only to pipeline implement stage resolution whose builder error is exactly the `implement.already_complete` message; every other resolution error, and the standalone `jarvis run workflow implement` path, is unchanged.
- Lane branch = the implement step's `worktree.branchName` (spec-dir basename default). PR lookup uses `listPrs` (`src/execution/github-operations.ts`, state `all`) from the project root with the injected runner; rules out inline `gh` argv.
- Exactly one open PR, or else exactly one merged PR, whose head is the lane branch → adopt: create a `completed` run row (project, lane branch, specPath, the lane's managed worktree path, `prNumber`, `prUrl`) and settle the stage `succeeded` with `stageArtifactFromEntryRun` over it. Dependents, forking, rebase-after-merge, and terminal publication then read it like any succeeded implement stage; rules out a pipeline-only artifact shape without an entry run.
- Closed-unmerged PRs are ignored. More than one open PR, or no open PR and more than one merged PR → stage `failed` retryable naming the PR numbers; rules out guessing.
- No adoptable PR, and the lane branch exists locally with commits not reachable from the base → stage `failed` retryable with a message naming the branch, the unpublished commit count, and the recovery (push the branch, open a PR, then `jarvis pipeline resume <id> <lane>`). Automatic publication of such a branch is out of scope.
- No adoptable PR and no unpublished commits → today's `implement.already_complete` failure, unchanged.
- `listPrs` failure → stage `failed` retryable with the lookup error; no adoption, no fallback to the commit check.

## Task checklist

- [x] Route the `implement.already_complete` resolution error through a lane-PR adoption check before `failWorkflowStageAt`.
- [x] Create the adoption run row and settle the stage `succeeded` with its artifact.
- [x] Add the unpublished-commits and ambiguous-PR refusals.
- [x] Tests in `src/daemon/pipeline-execution.test.ts` (or the resolve/dispatch test file owning implement stage settlement) with an injected `gh`/git runner.

## Acceptance criteria

- [x] A regression test drives a chained implement stage whose spec tree is complete and whose lane branch has one open PR; the stage settles `succeeded`, its artifact carries that `prNumber`/`prUrl`, and its `entryRunId` loads a `completed` run whose `branch` is the lane branch. It fails against the pre-fix code (stage `failed` with `implement.already_complete`).
- [x] The same test shape with one merged PR (no open PR) settles `succeeded` with that PR's evidence.
- [x] A test with a complete tree, no open or merged PR, and a lane branch carrying commits not on base settles the stage `failed` with `retryable: true` and a failure observation naming the branch, the commit count, and `jarvis pipeline resume`; it fails against the pre-fix code.
- [x] A test with two open PRs on the lane branch settles `failed` retryable naming both PR numbers, with no adoption run row created.
- [x] A test whose PR lookup fails settles `failed` retryable carrying the lookup error, with no adoption run row created.
- [x] `pipeline-stage-resolve.test.ts` `chained implement stage returns already_complete for complete git-disabled external plan tree` stays green (no PR, no unpublished commits → unchanged refusal).
- [x] After adoption, a chained dependent lane's next stage dispatches with `worktree.forkRef` derived from the adopted lane branch, as for a harness-published predecessor (test).
- [x] `bun run typecheck` passes.
- [x] `bun run test:agent` passes.

## Documentation updates

- `docs/daemon-host.md` § Pipeline stage resolution: the complete-tree `implement.already_complete` sentence gains the adoption and unpublished-commits branches.
- `docs/pipeline-execution.md`: implement stage settlement by adoption (run row, artifact, refusals).
- `docs/operator-runbook.md`: hand-finished lane recovery — publish the branch, open the PR, `jarvis pipeline resume <id> <lane>`.
- `docs/v1-behaviors.md`: `[harness behavior change]` entry for adoption replacing the unconditional `already_complete` stage failure.
