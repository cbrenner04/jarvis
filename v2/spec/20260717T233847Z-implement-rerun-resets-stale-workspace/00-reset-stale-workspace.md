# Reset stale workspace on incomplete implement re-run

## Problem

Re-running `jarvis run workflow implement` for an incomplete spec reuses the stale
workspace: `ensureExternalWorktree` (`v2/src/execution/external-worktree.ts`) checks
out the existing branch instead of recreating from base, and `findOrCreatePr`
(`v2/src/execution/completion-publisher.ts`) reuses the stale draft PR. Prior ticked
work never carries forward, so the re-run should instead start clean from the
requested base.

Fix: before the write step runs, an incomplete implement re-run retires the stale
worktree, local + remote branch, and matching draft PR and lets materialization
recreate the branch from `--base`; the next publication opens a fresh draft PR. If a
guard blocks a safe reset, the run exits non-zero naming the blocking state and
mutates nothing.

The reset reuses the existing abandon primitive's guards and teardown
(`v2/src/commands/cleanup.ts`: `isWorktreeLiveHeld`, `findAllOpenPrsForBranch`,
`performAbandonmentSteps`), keyed on the resolved `(project, branch)` rather than an
interactive name lookup.

## Decisions

- Reset runs in the implement run preflight after a successful step build, before the daemon starts the run; rules out daemon-side placement and a duplicate live/PR guard implementation.
- Gate on the successful build: `buildImplementWorkflowSteps` already fails complete specs with `implement.already_complete`, so reset only reaches incomplete specs; rules out a second completion re-check.
- No stale worktree, branch, and PR present ⇒ reset is a no-op and the run proceeds; rules out erroring on a first run.
- Refusal is a non-zero exit naming the blocking state, not a confirmation prompt; rules out reusing abandon's interactive confirm.
- Skip reset for git-disabled runs; rules out branch teardown where no branch exists.
- Close the draft PR before deleting its branch (reuse `performAbandonmentSteps` ordering); rules out stranding a fresh publication against a closed-branch PR.

## Task checklist

- [ ] Add a keyed reset orchestrator in `cleanup.ts` reusing `isWorktreeLiveHeld`, `findAllOpenPrsForBranch`, `performAbandonmentSteps`; returns reset / no-op / refused-with-state.
- [ ] Wire it into the implement run preflight (CLI `runWorkflowCommand`, implement preset) after a successful build and before `start`; turn refusal into a non-zero exit and a stderr state message.
- [ ] Regression + refusal tests against a git fixture.
- [ ] Docs.

## Acceptance criteria

- [ ] Re-running `run workflow implement` for an incomplete spec whose resolved `(project, branch)` has a stale worktree, branch, and draft PR closes the draft PR, removes the worktree, and deletes the local and remote branch before the write step runs, then recreates the branch from `--base`; a regression test drives this against a real git fixture and fails against the pre-fix code.
- [ ] The reset refuses with a non-zero exit and mutates nothing when the workspace is live-held, when the matching PR is ready (non-draft), or when multiple open PRs match the branch; each refusal names the blocking state. New tests assert all three refusals and fail against the pre-fix code.
- [ ] The stale draft PR is closed before its branch is deleted (test asserts `gh pr close` precedes `git branch -D` / `git push origin --delete` by recorded argv order).
- [ ] A fresh implement run with no existing worktree, branch, or PR performs no reset teardown and proceeds to materialize the branch from base (regression test asserts no `gh pr close` / branch-delete calls).
- [ ] The source spec tree (index and subspecs) survives the reset (regression test asserts the files are intact afterward).
- [ ] An already-complete spec re-run still exits with `implement.already_complete` and performs no reset teardown (test asserts no teardown calls occur).

## Documentation updates

- `v2/docs/operator-runbook.md` — clean re-run behavior (incomplete implement re-run resets the stale workspace from base) and refusal recovery (live workspace, ready PR, ambiguous PR).
- `v2/docs/v1-behaviors.md` — record v2's reset-on-incomplete-re-run behavior.
