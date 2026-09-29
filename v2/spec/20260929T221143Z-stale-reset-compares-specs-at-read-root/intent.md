---
name: stale-reset-compares-specs-at-read-root
---

# Compare stale-reset criteria at the spec tree's read root

## Problem

`resetStaleWorkspace` can compare landed criteria only when the spec path is readable under the code project root. A spec tree in an external home or prior-stage worktree is discarded as untrackable, so gate 2 cannot distinguish unticked base criteria from newly ticked current criteria.

## Primary implementation surface

- `v2/src/commands/cleanup.ts`

## Decisions

- Let gate 2 describe the spec tree's current read root independently from the code worktree and compare the tree against the matching Git base from that location.
- Refuse retirement with a named reason when the current tree, linked subspecs, Git root, or base snapshot cannot be read. Inconclusive comparison is not permission to destroy.
- Keep in-project comparison behavior and `--reset-despite-landed-criteria`; the override bypasses only gate 2, including its inconclusive refusal.
- Do not extend out-of-root tracking to continuation tick-backing or change gates 1 and 3, committed-lane continuation, or `cleanup --abandon`.

## Acceptance criteria

- [ ] A `v2/src/commands/cleanup.test.ts` regression places a linked spec tree outside the code project root, ticks a subspec only in the current tree, and proves gate 2 refuses retirement naming that subspec; it fails against the current out-of-root early return.
- [ ] A test proves an unreadable or otherwise incomparable spec tree refuses retirement with a named reason and no retirement mutation.
- [ ] `v2/src/commands/cleanup.test.ts` in-project landed-criteria tests stay green, and new tests prove `--reset-despite-landed-criteria` bypasses only gate 2 for both in-project and out-of-root trees.
- [ ] `v2/src/commands/cleanup.test.ts` unlanded-commit, continuation, and `cleanup --abandon` tests stay green (gates 1 and 3, continuation tick-backing, and `cleanup --abandon` unchanged).
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md` — gate 2 compares external and prior-stage spec trees from their read root and refuses inconclusive context.

## Prerequisites

## Blocker

The review verdict asks (point 2) for a concrete scenario where out-of-root drift means real loss, before gate 2 is extended to compare it. Tracing the only reachable caller (point 1) turned up evidence against, not for, that harm — this needs the intent author's call before drafting can continue.

- The only path that reaches gate 2 out-of-root is a chained implement stage following a git-enabled plan/intent stage (`resolveChainedImplementSpecPath`, `v2/src/daemon/pipeline-stage-resolve.ts:310-331,575-632`). External-plan homes never carry a `specPath` into gate 2 at all (`writeStep.externalPlanSpec !== true` gate, `v2/src/commands/stale-reset-workspace.ts:34-36`), so that case is unreachable through the declared surface and should drop from the intent regardless of the rest of this blocker.
- In the chained case, the spec tree lives only in the prior stage's own worktree (`specReadRoot`/`preflightGitRoot`, `v2/src/execution/implement-workflow-steps.ts:389-393,709,730,754,757`). The implement stage's own code worktree — the one `resetStaleWorkspace` would retire — materializes at a different `(projectName, branchName)`, with `branchName` derived from the spec's own directory name (`basename(dirname(resolvedSpecPath))`, `implement-workflow-steps.ts:450`), never equal to the prior stage's branch. The two worktrees are always distinct directories.
- Retiring the implement worktree therefore never deletes or touches the prior worktree's spec file or its ticks — nothing there is lost by the reset itself.
- Gates 1 and 3 already compare the implement branch's own commit history against base directly (`unlandedCommitCount`/`carriesNoUnlandedCommits`, `isDescendantOfBase`) — the mechanism that actually protects code progress on that branch from being discarded.
- A prior stage's worktree can be the shared spec-read root for more than one downstream branch (fan-out), so its tick-vs-base drift reflects whichever lane last advanced it, not specifically the branch being reset. Comparing it for gate 2 risks refusing this lane's legitimate reset over a sibling lane's progress (verdict point 6), with no correctness benefit gates 1/3 don't already provide.

Net: for the one caller this intent's surface can reach, out-of-root gate 2 comparison appears to cost false-positive refusals without preventing any loss the existing gates miss. Before redrafting, please confirm one of:

1. A concrete loss scenario this trace missed (e.g. a caller where the prior stage's worktree and the retiring worktree are the same directory) — if so, name it so AC1's fixture can construct it.
2. The intent should proceed anyway for a reason other than loss-prevention (e.g. operator-visibility/audit value), in which case shared-tree ownership (verdict point 6) and the inconclusive-refusal recovery path (verdict point 4) need an explicit answer.
3. The intent should be dropped or narrowed to a docs-only correction of `v2/docs/v1-behaviors.md` recording that gate 2 is N/A out-of-root by design, with the reasoning above.
