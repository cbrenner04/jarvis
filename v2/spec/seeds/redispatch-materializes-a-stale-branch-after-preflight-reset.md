# Re-dispatch materialized a stale branch after preflight reported a clean reset

## Problem

On 2026-07-25 a `jarvis run workflow implement --base main` re-dispatch produced a worktree based on a
**pre-merge** commit, carrying commits from a branch that preflight had just reported deleting. The
run then implemented an outdated copy of the spec.

Preflight output claimed a clean reset:

```text
Removed worktree: ~/.jarvis/worktrees/jarvis/20260725T133816Z-intent-finalization-…
Deleted local branch: 20260725T133816Z-intent-finalization-…
Remote branch 20260725T133816Z-intent-finalization-… already absent
```

That third line is truthful: `deleteRemoteBranch` (`v2/src/commands/cleanup.ts:908`) runs
`git push origin --delete` and only prints `already absent` when the error matches
`/remote ref does not exist/i`, so the remote ref really was gone (the branch's PR had been
squash-merged, and GitHub deletes the head branch on merge).

But the materialized worktree's history was:

```text
878225ba  <new run's commit>
fe65c5c2  <new run's commit>
20983f4d  chore: apply biome formatter        <- from the already-merged PR
11668288  Intent finalization promotes …      <- from the already-merged PR
94ccc2d7  docs: correct the swept-partial-edits claim
```

`--base main` was `e8b85b13` at dispatch time. The worktree came up at `94ccc2d7` instead — before
the squash-merge of that work and before a spec change on `main`. So the run edited a spec file
(`02-intent-finalization-recovery.md`) that no longer existed on `main`, and ticked criteria in an
index `main` had already replaced.

**The mechanism is not established.** Preflight deleted the local branch and the remote ref was
genuinely absent, yet materialization still resolved pre-merge history. Do not cut a fix against a
guess — instrument what ref materialization actually resolves and where that base comes from, then fix.

Contributing context, not necessarily cause: the branch had been pushed and merged **by hand** by the
operator rather than by a run, so the local repo held `refs/heads/<branch>` and
`refs/remotes/origin/<branch>` from that push.

## Decisions

- Instrument materialization to record the ref it resolved and the commit it based the worktree on,
  and compare that against the requested `--base`. Rules out fixing the reset path against an
  unverified cause.
- A materialized worktree whose base does not match the resolved `--base` commit must fail loudly
  before the write step, not proceed. A run that silently edits an outdated spec tree wastes a full
  iteration and can tick criteria that no longer exist. Rules out treating base drift as benign.
- Preflight's reset must leave no local ref that can later resolve the branch name: whatever it
  deletes, a subsequent materialization for the same `(project, branch)` must start from `--base`.
- Candidate (operator suggestion, 2026-07-25): have `jarvis cleanup` also prune local and
  remote-tracking branches whose PR is merged, not only branches attached to a retired worktree.
  Note cleanup already deletes local branches for merged worktrees it retires, so this is about
  branches left behind by other paths — verify the gap is real before implementing.
- Out of scope: whether operators should hand-push run branches at all.

## Acceptance criteria

- [ ] Materialization records the resolved ref and resulting base commit for the worktree.
- [ ] A re-dispatch whose materialized base differs from the resolved `--base` commit fails before the
      write step with a named error; inverting the guard fails a test.
- [ ] After preflight reset, a re-dispatch for the same `(project, branch)` bases its worktree on
      `--base`, proven by a regression that seeds a stale local branch and remote-tracking ref for
      that name beforehand.
- [ ] Dead-branch pruning (if adopted) leaves branches with open PRs and unmerged branches untouched.

## Documentation updates

- `v2/docs/operator-runbook.md` § Recovery — a re-dispatch can inherit a stale base; how to confirm
  the worktree's base commit matches `--base` before trusting a run's output.
