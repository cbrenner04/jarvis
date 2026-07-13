# 00 - Fail the completion boundary on no-commit + dirty worktree

`createCompletionCommitter` (`v2/src/execution/completion-commit.ts`) can return `{}` — no
`commitSha`. Every caller treats that as "nothing to publish" and keeps the boundary at
`complete`: `executeWriteLoop`'s fresh-completion path (`write-loop.ts:368`), its
already-complete republish path (`write-loop.ts:155`), and `runWorkflow`'s completion step
(`workflow-runner.ts:705`, which only stamps/publishes when `commitSha` is defined).

Run `f9d556ed` (2026-07-13) hit that: terminal `done`, branch head equal to `main`, three
modified files still dirty in the worktree, no PR — reported to the operator as success.

## Decisions

- No commit sha + a dirty worktree at the completion boundary yields the existing retryable
  `completion_commit_failed` outcome; rules out both today's silent `complete` and minting a new
  outcome kind (the vocabulary, its exit code `1`, and its `resume` operator action already fit).
- Dirtiness is read from the worktree at the boundary (`git status --porcelain`, untracked
  included) rather than inferred from the committer's return shape; the committer has several
  `{}` paths and the operator-facing question is only "is work still on disk".
- `completionCommitError` names the leftover paths so the operator can recover them.
- No commit sha + a clean worktree stays `complete` (nothing was left behind).
- Worktree and branch are retained — inherited from `completion_commit_failed`, which is already
  resumable and skips cleanup; no cleanup change is in scope.

## Acceptance criteria

- [ ] A completion boundary where the committer returns no commit sha and the worktree still has
      uncommitted changes records `completion_commit_failed` (resumable), not `complete` — in
      `executeWriteLoop`'s fresh-completion path, its already-complete republish path, and
      `runWorkflow`'s completion step.
- [ ] `completionCommitError` on that outcome names the uncommitted paths.
- [ ] The `loop_finished` record emitted at that boundary carries
      `loopOutcomeKind: "completion_commit_failed"`.
- [ ] A completion boundary with no commit sha and a clean worktree still records `complete`.
- [ ] Existing `write-loop.test.ts` / `workflow-runner.test.ts` completion-boundary tests and
      `completion-commit.test.ts` stay green (no-op and republish paths unchanged for clean
      worktrees).

## Documentation updates

- `v2/docs/write-behavior.md` — completion boundary: a `complete` outcome implies a commit; a
  no-commit boundary over a dirty worktree is `completion_commit_failed` naming the paths.
- `v2/docs/operator-runbook.md` § Gate trust — `completed` on a v2 implement run implies a
  completion commit exists; drop the "verify the branch has commits" caveat.
