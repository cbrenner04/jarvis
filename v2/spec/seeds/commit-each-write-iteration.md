# Commit each write-loop iteration, not just the completion boundary

## Problem

Git commits happen only at the completion boundary: the write loop invokes
`createCompletionCommitter()` when the loop settles (`v2/src/execution/write-loop.ts:178`, `:442`,
`:966`). Per-iteration `store.commitCompletionBoundary(...)` calls are *state-store* boundaries, not
git commits. Everything an agent writes across N iterations sits uncommitted in the managed worktree
until the run completes.

Consequences:

- A killed, timed-out, or daemon-reconciled run loses every iteration's work — the runbook already
  records this ("the killed iteration's agent work does **not** survive... its token spend is lost").
- An incomplete implement re-run's `resetStaleWorkspace` force-removes that same uncommitted work.
- There is no per-iteration history to review; the PR shows one squashed completion commit, so the
  path the agent took is invisible.

v1's patch loop commits per iteration; v2 regressed on this.

## Decisions

- Commit at the end of each write-loop iteration that changed files, with a message identifying the
  iteration and the active spec/subspec, carrying the existing `Jarvis-Agent:` trailer.
- An iteration that changed nothing produces no commit.
- The completion boundary keeps its current contract (`completion_commit_failed` when the worktree
  is dirty and the committer returns no new commit) — per-iteration commits reduce what it has to
  absorb but do not replace it.
- Reuse the existing committer seam; rules out a second commit path.
- PR attribution and the narrative marker block must still render correctly over a multi-commit
  branch; the attribution renderer already groups by trailer.
- Rules out pushing per iteration — publication stays at the completion boundary.

## Acceptance criteria

- [ ] A write loop that changes files across multiple iterations produces one commit per changed
      iteration on the run's branch, each carrying the `Jarvis-Agent:` trailer.
- [ ] An iteration that changes nothing produces no commit.
- [ ] A run killed mid-loop leaves prior iterations' work committed on the branch.
- [ ] The completion boundary still reports `completion_commit_failed` when the worktree is dirty
      and no new commit is produced.
- [ ] The PR attribution footer renders correctly for a multi-commit branch.
- [ ] `bun run typecheck`, `test:v2`, `test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — per-iteration commit contract.
- `v2/docs/operator-runbook.md` — recovery expectations after a killed run.
- `v2/docs/v1-behaviors.md` — record v2 parity with v1's per-iteration commits.
