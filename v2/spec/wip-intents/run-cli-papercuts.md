# Run-mode papercuts: exit-reason legend, `run --help`, failed-plan cleanup

## Problem

Three small, independent friction points slowed an otherwise-smooth session driving Jarvis on a
target repo. Each is cheap; grouped here as a papercut seed (the intent flow can split them).

## Items

- **Opaque run exit codes.** Runs ended with `RUN_RC` of `0`, `5`, `7`, etc. with no legend; the
  operator inferred the meanings. Plan mode prints an "exit reason"; run mode's is less clear. Add
  a one-line exit-reason mapping to the run summary so the code is self-describing.
- **No `jarvis run --help`.** `--help` was parsed as a spec path (`spec path does not exist:
  …/--help`). Add a usage string for `run` (and audit the other subcommands for the same).
- **Stale `plan/*` worktrees/branches after a failed plan.** A failed plan left
  `.worktree/plan-<name>` + `plan/<name>` behind, needing manual `git worktree remove` /
  `branch -D`. Clean these up on plan failure. (Related to the cleanup guards in
  [[plan-git-false-boundary-misfire]] — that failure is one way these get orphaned.)

## Out of scope

- Reworking exit-code *values* — only documenting/surfacing them.

## Documentation updates

- `v1/docs/run-loop.md` — the exit-reason legend.
- `v2/docs/v1-behaviors.md` if any behavior (cleanup) changes.

## References

- groceries `redesign-fixups-report.md` §5.6 — source.
- `v1/src/run-summary.ts` — run summary output (exit-reason legend).
