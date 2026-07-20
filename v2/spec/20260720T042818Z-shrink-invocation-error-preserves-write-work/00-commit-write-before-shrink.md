# Commit implement write output before the shrink pass

## Problem

`executeWorkflow` runs the hidden shrink pass on top of the implement write
step's *uncommitted* output (`workflow-runner.ts` `runShrinkAfterImplementComplete`,
gated at the `role: "implement"` completion). The implement write step runs with
`publishCompletion: false`; the only git commit is the final publication commit
(`completion-commit.ts`, `git add -A`). So when shrink hits `invocation_error`,
the completed implementation is left uncommitted in the worktree with no commit —
lost if the operator abandons the run.

## Decisions

- After an `implement` write step returns `complete`, commit its output to the branch before invoking the hidden shrink pass — rules out leaving the write uncommitted until publication (the current behavior that strands it on shrink failure).
- The pre-shrink commit fires only for `implement`-role write steps that route to the shrink pass (same gate as `runShrinkAfterImplementComplete`) — rules out committing every write step's output at its own boundary.
- The published branch on the success path still carries a single completion commit; shrink's later edits and the pre-shrink commit fold into that one commit, not a second commit in the PR — rules out a two-commit branch shape that regresses publication.
- No-`.git` / git-disabled worktrees skip the pre-shrink commit without error, matching `completion-commit.ts`'s existing `.git` guard — rules out failing git-disabled implement runs.

## Task checklist

- Commit the completed `implement` write output before `runShrinkAfterImplementComplete` invokes shrink.
- Keep the success-path published branch at one completion commit (fold pre-shrink commit + shrink edits into publication's commit).
- Add a `workflow-runner.test.ts` regression driving implement→complete with an injected shrink `invocation_error`, asserting the implementation is committed on the branch.

## Acceptance criteria

- [ ] A new test in `v2/src/execution/workflow-runner.test.ts` drives an `implement` write step to `complete`, injects a shrink `invocation_error`, and asserts the branch HEAD carries the completed implementation as a commit (the worktree is not left with the implementation uncommitted); it fails against the pre-fix code.
- [ ] The pre-shrink commit fires only for `implement`-role write steps routing to the shrink pass; a non-implement write step's commit timing is unchanged.
- [ ] Existing completion-commit and publication tests in `v2/src/execution/workflow-runner.test.ts` and `v2/src/execution/write.test.ts` stay green (success-path published branch shape unchanged).
- [ ] An `implement` run in a no-`.git` worktree completes the pre-shrink step without error.
- [ ] `v2/docs/workflow-runner.md` describes the commit-before-shrink ordering.

## Documentation updates

- `v2/docs/workflow-runner.md` — execution contract: implement write output is committed before the hidden shrink pass runs.
- `v2/docs/v1-behaviors.md` — update the v2 implement/shrink entry to state the write commits before shrink runs.
