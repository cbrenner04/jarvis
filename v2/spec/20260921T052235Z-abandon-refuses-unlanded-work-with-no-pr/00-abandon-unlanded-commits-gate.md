# Abandon unlanded-commits gate

`cleanup --abandon <name>` retires a branch carrying unlanded non-staging commits when no PR exists, destroying work. Add an admission gate reusing the stale-reset unlanded-commits predicate, plus a `--discard-unlanded` override.

## Decisions

- Reuse `unlandedCommitCount` / `unlandedNonStagingPaths` / `carriesNoUnlandedCommits` and `staleResetUnlandedCommitsGateReason` wording in `v2/src/commands/cleanup.ts`; no parallel predicate (rules out a divergent abandon-only check).
- Reuse `isDescendantOfBase(branch, worktreeHead, …)` and `staleResetUnreachableWorktreeHeadGateReason` for commits reachable only from the worktree `HEAD` (abandon force-removes the worktree); no parallel check.
- Unlanded-commits refusal names the branch tip SHA; the unreachable-`HEAD` refusal names the worktree `HEAD` SHA.
- Base resolves through the existing `getBaseBranch`.
- Fail-closed: a missing `projectRoot` or a throwing git probe refuses (matches the predicate returning `false`), never admits.
- Gate runs only when `gateOnOpenPrs` reports no open PR. Draft-PR (closed during retirement), ready, multi-PR, and `unknown` (gh unreachable, fail-closed) outcomes keep today's paths. `gh pr list` returns open PRs only, so a closed-unmerged PR is invisible to the gate and counts as no PR.
- Gate runs before the preview and confirm prompt and before any mutation (PR close, worktree/branch removal); the operator is never asked to confirm something then refused.
- Refusal names tip SHA, commit count, and recovery: hand-finish, or re-run with `--discard-unlanded`. Scoped `--abandon <name>` refuses exit `1`. There is no global abandon (`abandon` is a string flag); non-abandon bulk retirement untouched.
- `--yes` does not bypass; only `--discard-unlanded`, which also skips the unreachable-`HEAD` gate. `--discard-unlanded` without `--abandon` → usage, exit `1` (`cleanup-cli.ts`).

## Acceptance criteria

- [ ] New cleanup test `abandon refuses a branch with unlanded commits and no PR`: ahead-of-base non-staging commits, no PR → refusal naming tip SHA and commit count; worktree, local and remote branches untouched, no PR close attempted; fails pre-fix.
- [ ] New cleanup test `abandon refuses when the worktree HEAD is unreachable from the branch`: refusal names the worktree `HEAD` SHA; worktree and branch untouched; fails pre-fix.
- [ ] New cleanup test `abandon refusal for unlanded work is not bypassed by --yes`.
- [ ] New cleanup test `abandon refusal happens before the confirm prompt`: no preview or prompt is issued on refusal.
- [ ] New cleanup test `abandon discards unlanded work under the explicit override`: `--discard-unlanded --yes --abandon` completes ordinary retirement.
- [ ] New cleanup test `abandon retires a branch whose commits are all on base`.
- [ ] New cleanup test `abandon retires a squash-merged branch`: pins the `merge-tree` squash handling in `carriesNoUnlandedCommits`.
- [ ] New cleanup test `abandon retires a branch whose only unlanded commits are harness staging`.
- [ ] New cleanup test `abandon proceeds for a draft PR with unlanded commits`: the PR is closed and the branch retired.
- [ ] New cleanup test `abandon refuses unlanded work when the PR is closed unmerged`: `gh` stub reports a closed-unmerged PR for the branch (not in the open list); the gate ignores it and refuses.
- [ ] New cleanup test `abandon refuses when gh is unreachable and the branch has unlanded commits` (fail-closed; nothing retired).
- [ ] New cleanup test `abandon refuses when a git probe fails`: probe throws → refusal, nothing retired.
- [ ] New cleanup-cli test `--discard-unlanded without --abandon prints usage`.
- [ ] New cleanup-cli test `--abandon <name> --discard-unlanded` parses and passes the override through to cleanup.
- [ ] `v2/docs/operator-runbook.md` § `--abandon` documents the refusal, `--discard-unlanded`, and a session-close note that a circuit-broken lane looks like debris without `git rev-list --count <base>..<branch>`.
- [ ] `v2/docs/v1-behaviors.md` `[v2 difference]` `cleanup --abandon` entry records the unlanded-commits gate, staging exemption, draft-PR/closed-PR behavior, and `--discard-unlanded`.
- [ ] `bun run typecheck`, `bun run test:v2`, `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § `--abandon`.
- `v2/docs/v1-behaviors.md` `cleanup --abandon` `[v2 difference]` entry.
