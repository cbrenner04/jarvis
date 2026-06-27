# Commit partial progress on agent-error exit

## Problem

In a git-enabled patch run, the `agent-error` branch (`iteration.ts`, the
`exitReason: "agent-error"` path returning exit 3) writes telemetry and returns
without committing the failing iteration's work. When the agent edited files or
ticked criteria before erroring, the worktree is left dirty (uncommitted edits +
untracked litter), so the residual state is neither a clean no-op nor a committed
WIP branch. Resume then starts on top of an uncommitted, ungraded mess.

Normalize the producer side: on agent-error, if the iteration left progress,
commit it as a `WIP:` commit so the worktree is left clean; otherwise leave the
branch at base with no spurious commit.

## Decisions

- Commit WIP on agent-error only when the iteration left tracked edits or newly-checked AC; no progress → no commit, branch stays at base. Rules out empty/no-op WIP commits on every agent-error.
- Progress = newly-checked AC and/or edited tracked files only; untracked-only file creation (no checked AC, no tracked edits) is NOT progress and yields no commit. Rules out treating stray agent litter as progress and minting a WIP commit that only captures it.
- Reuse the existing `commitWipProgress` path (stages `git add -A`, `WIP: <h1> (N/M criteria)` summary, `Jarvis-Agent` trailer). Rules out a divergent commit format that resume/cleanup tooling wouldn't recognize.
- Litter clearing is NOT done here — the WIP commit captures untracked files via `git add -A` as today; clearing belongs to the no-progress/orphan path in subspec 01. `git add -A` does not stage gitignored files, so gitignored litter (e.g. `test_output.txt`) survives the WIP commit and is 01's responsibility. Rules out diverging WIP-commit staging from existing behavior.
- On `commitWipProgress` failure, exit 1 (harness error), not 3. Rules out classifying a harness commit failure as an agent-error retry candidate or swallowing it into the exit-3 path.
- Exit code stays 3 on the success and no-progress paths. Rules out swallowing the agent-error into a success/blocked exit.
- Only git-enabled runs are affected; no-commit runs keep their #520 delta reset. Rules out double-handling no-commit state.

## Task checklist

- [ ] In the agent-error exit path, before returning exit 3, detect iteration progress (newly-checked AC and/or edited tracked files already computed as `checkedAnyCriteria` / `editedFiles`).
- [ ] When progress exists, call `commitWipProgress` for the active subspec; on commit failure, exit 1 with a named harness error.
- [ ] When no progress exists, return exit 3 unchanged (no commit).
- [ ] Add a test asserting the dirty-worktree agent-error case ends with a clean worktree + a `WIP:` commit, and the no-progress case ends with no new commit.

## Acceptance criteria

- [x] On `agent-error` (exit 3) in a git-enabled run where the failing iteration left tracked edits or newly-checked acceptance criteria, a `WIP: <h1> (N/M criteria)` commit is created before exit and the worktree has no uncommitted tracked changes.
- [x] On `agent-error` in a git-enabled run with no tracked edits and no newly-checked criteria (even if the iteration created untracked-only files), no commit is created and the branch tip stays at the base commit.
- [x] When `commitWipProgress` fails on the agent-error WIP commit, the run exits 1 with a named harness error rather than exit 3.
- [x] The run still exits 3 (`agent-error`) on the progress (WIP committed) and no-progress paths; normalization does not change the cascade exit reason.
- [x] A new test in `v1/test` covers both the progress (clean worktree + WIP commit) and no-progress (no commit) agent-error branches.
- [x] `run.test.ts` agent-error exit-3 tests stay green (exit reason unchanged by the added commit step).

## Documentation updates

- [ ] `v1/docs/run-loop.md`: in the exit-code / `agent-error` description, note that a git-enabled agent-error commits partial progress as a `WIP:` commit, leaving a clean worktree.
- [ ] `v1/docs/worktrees-and-commits.md`: add the agent-error WIP commit to the enumerated WIP commit paths.
- [ ] `v2/docs/v1-behaviors.md`: record the new agent-error residual-state behavior (commit-WIP-or-clean) as current v1 behavior.
