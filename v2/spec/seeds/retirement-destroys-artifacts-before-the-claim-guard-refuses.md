# Stale-workspace retirement destroys artifacts before the worktree-claim guard refuses

## Problem

An incomplete `jarvis run workflow implement` re-run ran `resetStaleWorkspace` to completion —
removing the materialized worktree, the local branch, and the remote branch — and *then* refused
admission with `worktree_claimed`. The refusal is a pre-mutation guard in name only: by the time
it fired, every artifact it was protecting was already gone.

Observed 2026-07-26 on `20260725T004726Z-write-path-idle-output-watchdog`. The branch carried one
completion commit and a dirty worktree of in-flight actuator edits from a review step. Both were
destroyed. Command output, in order:

```text
Remote branch 20260725T004726Z-write-path-idle-output-watchdog already absent
worktree_claimed: Worktree already claimed for project=jarvis, branch=20260725T004726Z-...
Retirement destroyed artifacts:
  worktree: /Users/christopherbrenner/.jarvis/worktrees/jarvis/20260725T004726Z-...
  local branch: 20260725T004726Z-...
  remote branch: 20260725T004726Z-...
```

The claim was held by a wedged durable row (`in-progress` + `live`, zero agent processes,
`jarvis run log` hanging) — the `daemon stop` / `run kill` deadlock. So the guard that refused was
reporting a condition that was already true *before* retirement started.

The runbook documents `worktree_claimed` as benign ("invoke the workflow again; the daemon drops
that in-memory claim at admission"). That advice assumes the refusal cost nothing. Here it cost the
run's only commit.

Second-order damage: retirement left an ordinary non-Git directory at the managed path (containing
only `.claude/`). The next re-dispatch died even earlier, in the dirty-worktree preflight, with
`could not list worktree changes (fatal: not a git repository)` — a state whose named recovery
(`jarvis cleanup --abandon <branch>`) cannot apply, because `--abandon` resolves names only through
materialized worktrees. Recovery required `rm -rf` plus `git worktree prune` by hand.

## Decisions

- The worktree-claim check must run before `resetStaleWorkspace` mutates anything, with the other
  pre-mutation refusals (live-held, non-draft PR, multiple open PRs, dirty worktree). Rules out
  keeping the current ordering and only improving the error text.
- Ordering only. Every existing refusal and every destructive step keeps its current behavior;
  this changes *when* the claim is consulted, not what it permits. Rules out relaxing the claim
  check so retirement can proceed.
- A husk left at the managed path must not strand the next re-dispatch behind an error whose named
  recovery cannot reach it: either the dirty-worktree preflight classifies a non-Git path as a husk
  and defers to the existing husk-removal path, or the refusal names a recovery that actually
  applies to a non-materialized path. Rules out leaving `rm -rf` as the operator's only route.
- Out of scope: fixing the wedged-row deadlock that held the claim
  (`ready-intents/workflow-stall-is-observable-and-kill-reaps-it` owns that).

## Acceptance criteria

- [ ] A re-run whose `(project, branch)` is claimed refuses with `worktree_claimed` and leaves the
      worktree, local branch, remote branch, and open PR intact; a test asserts no retirement step
      ran and fails against the pre-fix ordering.
- [ ] That refusal prints no `Retirement destroyed artifacts:` block, because nothing was destroyed;
      a test asserts its absence.
- [ ] The claim check is ordered with the other pre-mutation refusals: a test covering a run that is
      both claimed and dirty asserts a single pre-mutation refusal and zero mutations.
- [ ] An unclaimed re-run still retires the stale workspace exactly as today (existing
      `resetStaleWorkspace` tests stay green).
- [ ] A re-dispatch against a managed path holding a non-Git husk does not fail in the
      dirty-worktree preflight; a test drives a husk path and asserts the run reaches
      materialization, and fails against the pre-fix code (`not a git repository`).

## Documentation updates

- `v2/docs/operator-runbook.md` — § Implement workflow: state that `worktree_claimed` is a genuine
  pre-mutation refusal, and drop the implication that a claim refusal is always free. § Recovery:
  record husk-at-managed-path handling.
