# Mutation repair re-verifies before and after each attempt and never leaves stray edits

## Problem

Verified on lanes today (`workflow-runner-resume.ts`): (a) resume replays the persisted survivor (`survivingMutationErrorFromTerminalRecord`, consumed in the resume dispatch ~:2884) straight into `write.mutation-repair` without re-verifying HEAD, so a killing test committed after the terminal record is never seen; (b) a repair iteration that times out/stalls (`runMutationRepairIteration` → `"unsettled"`) or reports blocked settles via `settleMutationRepairExhausted` leaving the agent's uncommitted edits in the worktree; (c) on lane `b7c7b1fd` the repair agent rewrote a working killing test into a non-killing one (uncommitted). Subspec 00's shared in-flow driver inherits all three unless the loop itself enforces them.

## Decision ledger

- Before every repair iteration (in-flow and resume, attempt 1 included), run `verifyDiffDerivedMutations` on the current HEAD with the run base; pass → skip repair and continue to commit/publish; survivor → repair that fresh survivor. A persisted/recorded survivor is never the repair target; rules out replaying `survivingMutationErrorFromTerminalRecord` into the agent.
- Record pre-iteration HEAD before each repair iteration. On `"unsettled"` (timeout/stall/abort/error) or `"blocked"`, restore the worktree to that HEAD (discard tracked edits and untracked files the iteration created) before settling; rules out settlement that leaves uncommitted repair edits in the worktree.
- After each repair commit, re-verify. The verifier result gains an additive field listing candidate identities (`sourceSiteFile`, `sourceSiteLine`, `mutation`) it killed. If any candidate killed in the pre-iteration verification survives post-commit (regression), reset to the pre-iteration HEAD (drop the repair commit, before any push of it), count the attempt consumed, and continue with the pre-iteration survivor; rules out accepting a repair that turns a previously-killing test non-killing.
- Enforcement lives in the shared repair driver from subspec 00 so in-flow publication and `jarvis run resume` both get it; `runMutationRepairIteration` stays the single-iteration agent step. This subspec owns pre/post verification and revert logic only; the `promptPlaceholders` block of `runMutationRepairIteration` belongs to sibling lane `mutation-reprompt-colocated-fix-line` and must not be edited here.

## Task checklist

- Add pre-iteration HEAD capture + re-verify-before-repair to the shared driver; remove the direct recorded-survivor → repair path in resume dispatch.
- Add worktree restore to pre-iteration HEAD on `"unsettled"`/`"blocked"` before settlement.
- Expose killed-candidate identities on the verifier result (additive) and implement the post-commit regression check + reset.
- Tests below; docs per Documentation updates.

## Acceptance criteria

- [ ] `workflow-runner-resume-review-dispatch.test.ts` new case: terminal record carries survivor X, HEAD already contains a commit whose killing test kills X; resume invokes the verifier before any repair agent and dispatches zero `write.mutation-repair` iterations, proceeding to publish; fails against main where `survivingMutationErrorFromTerminalRecord` feeds repair directly.
- [ ] New case (resume dispatch test file or `write-loop.test.ts`): repair agent writes an uncommitted edit to a tracked file and a new untracked file, then times out (`unsettled`); after settlement `git status --porcelain` in the worktree is empty and HEAD equals the pre-iteration sha; fails against main where edits remain.
- [ ] Same shape for a repair agent that reports `blocked`: worktree clean at pre-iteration HEAD after settlement; fails against main.
- [ ] New case: pre-iteration verification kills candidate K and reports survivor S; the repair commit makes K survive; the driver resets HEAD to the pre-iteration sha (repair commit absent from `git log`, never pushed) and the next attempt targets S; fails against main which keeps and publishes the regressing commit.
- [ ] `mutation repair stops at its bound and reports a non-retryable operator error` and `every mutation-repair commit is published before the next repair or exhaustion under the real verifier` stay green (adjusted only for added verify calls).
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/write-behavior.md` — mutation repair re-verifies HEAD before each attempt, reverts regressing repair commits, and restores the worktree on unsettled/blocked repair.
- `v2/docs/operator-runbook.md` — after `mutation_repair_exhausted`/blocked the worktree is clean at the last verified HEAD; resume re-verifies rather than replaying the recorded survivor.
