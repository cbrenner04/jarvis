# Admit never-landed standalone plan re-dispatch

## Problem

Standalone `jarvis run workflow plan --ready-intent <path>` sends an existing plan worktree directly through stale reset. When the worktree `HEAD` predates or diverges from the resolved base, the descendant gate refuses it even when the lane has no open PR and no non-staging commits. Failed pipeline plan resume already proves the same lane disposable and rematerializes it, leaving standalone re-dispatch to require a redundant `cleanup --abandon` and retry.

## Decisions

- Standalone plan re-dispatch classifies an existing materialized lane before stale reset and passes `disposableLane` only for `never-landed`; rules out weakening the descendant gate for all stale workspaces.
- Standalone and failed-pipeline plan admission use the existing `classifyNeverLandedLane` policy and shared fail-closed outcome; rules out cloning PR and commit guards at the CLI boundary.
- Standalone inconclusive classification uses standalone command and recovery text while pipeline resume retains its pipeline-specific formatter; rules out a CLI refusal that tells an operator to resume a pipeline.
- `landed` classification keeps ordinary stale-reset admission, so an ahead-of-base commit touching any non-staging path remains protected; rules out treating every non-descendant plan branch as disposable.
- `inconclusive` classification refuses before stale reset and preserves the lane; rules out interpreting an unavailable `gh` probe or failed Git inspection as absence of landed work.
- Any open PR classifies the lane `landed` and preserves it without dispatch or retirement; rules out treating a draft PR as disposable attempt state for standalone re-dispatch.
- Confirmed `never-landed` bypasses descendant and landed-criteria preservation through `disposableLane`; rules out preserving checked criteria from a lane already proven disposable.
- The landed-criteria half of that bypass is **inert on the standalone plan path**, and is retained only for the shared helper's other callers. `buildPlanWorkflowSteps` names a freshly-timestamped durable spec directory (`${timestamp}-${ready.name}`) on every invocation, so on a re-dispatch the `specPath` it supplies refers to a directory present in neither tree and `landedCriteriaAbsentFromBase` can never report drift. Recorded so a later change does not "fix" the gate into reachability without deciding whether a plan lane should preserve criteria at all.
- `disposableLane` does **not** bypass the check that the worktree `HEAD` is reachable from the branch ref. Classification reasons only from `branch` versus `baseRef`, so a commit reachable solely from the worktree — a detached `HEAD`, or a branch ref moved back while the worktree kept committing — is invisible to it, and the descendant gate was the only thing resolving `HEAD` inside the worktree. Rules out retirement destroying a commit no ref can reach.
- Successful standalone retirement emits the existing `failed plan resume worktree disposition: retired-and-rematerialized from base` line before workflow dispatch; rules out a second disposition vocabulary for the same reset outcome.
- Fresh standalone plan dispatch skips classification and emits no retirement disposition; rules out probing `gh` or treating first materialization as stale reuse.
- Classification applies only to standalone `plan`; rules out changing `intent`, `implement`, or the shared descendant gate.
- Mutation-time classification/reset TOCTOU hardening is out of scope; rules out expanding this CLI-admission change into shared-reset behavior.

## Task checklist

- [ ] Reuse the never-landed classifier and shared fail-closed outcome in standalone plan stale-reset preparation.
- [ ] Pass the disposable-lane marker only after confirmed never-landed classification.
- [ ] Emit the shared retirement disposition before dispatch.
- [ ] Add focused CLI regression coverage for retirement, landed-criteria bypass, landed-work preservation, inconclusive refusal, and fresh dispatch.
- [ ] Preserve ordinary pipeline plan admission without disposable classification or retirement disposition.
- [ ] Align durable operator, pipeline-execution, workflow cross-link, and behavior-catalog docs.

## Acceptance criteria

- [x] A regression test in `v2/src/commands/workflow.test.ts` re-dispatches a never-landed plan lane whose `HEAD` is not a descendant of base, proves the old `stale reuse refused` path fails against the pre-fix code, then proves retirement, rematerialization at base, the exact disposition line, and daemon dispatch.
- [x] A regression test proves the landed-criteria bypass reaches `resetStaleWorkspace` when set, and `v2/src/commands/stale-reset-workspace.test.ts` pins that a standalone plan lane's freshly-timestamped `specPath` is threaded through unchanged — the shape that makes the gate inert on this path, rather than the implement fixture's stable `index.md`.
- [x] `v2/src/commands/cleanup.test.ts` proves a worktree `HEAD` unreachable from the branch ref is refused even with `disposableLane` set, preserving the worktree; it fails against code without that gate, which retires the lane and discards the commit.
- [x] A regression test in `v2/src/commands/workflow.test.ts` proves an ahead-of-base plan commit touching a non-staging path refuses before retirement and dispatch, preserving the worktree, branch tip, and commit.
- [x] A regression test in `v2/src/commands/workflow.test.ts` proves a non-descendant plan lane with any open PR refuses before retirement and dispatch, preserving the worktree and branch tip.
- [x] A regression test in `v2/src/commands/workflow.test.ts` proves an inconclusive open-PR probe emits standalone plan command and recovery text before retirement or dispatch, preserves the worktree, and emits no retirement disposition.
- [x] A regression test in `v2/src/commands/workflow.test.ts` proves fresh standalone plan dispatch makes no never-landed classification or `gh` probe and emits no retirement disposition.
- [x] A preservation regression in `v2/src/daemon/pipeline-execution.test.ts` proves ordinary pipeline `plan` dispatch neither classifies its lane as disposable nor emits a retirement disposition.
- [x] `v2/src/daemon/pipeline-execution.test.ts` never-landed retirement, landed-work refusal, inconclusive-probe refusal, and disposition tests stay green.
- [x] `v2/src/commands/cleanup.test.ts` never-landed classification and disposable-lane reset tests stay green.
- [x] `v2/docs/operator-runbook.md` documents automatic standalone plan retirement and removes `cleanup --abandon` as the required step for a confirmed never-landed lane.
- [x] `v2/docs/pipeline-execution.md` documents standalone and failed-pipeline plan's shared classification, fail-closed refusal, disposal semantics, and ordinary-pipeline exclusion, replacing its sole-caller and standalone-unchanged wording.
- [x] `v2/docs/workflow-runner.md` cross-links the shared classification contract in `v2/docs/pipeline-execution.md` without duplicating it.
- [x] `v2/docs/v1-behaviors.md` records standalone plan's changed non-descendant re-dispatch behavior and unchanged landed/inconclusive guards.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/operator-runbook.md` — standalone plan re-dispatch automatically retires a confirmed never-landed lane; retain cleanup guidance only for protected or inconclusive refusals.
- `v2/docs/pipeline-execution.md` — canonical shared never-landed classification, fail-closed refusal, disposal semantics, standalone admission, and ordinary-pipeline exclusion.
- `v2/docs/workflow-runner.md` — cross-link the canonical `pipeline-execution.md` contract without duplicating it.
- `v2/docs/v1-behaviors.md` — replace standalone plan's unconditional non-descendant refusal with the never-landed exception and preserved guards.
