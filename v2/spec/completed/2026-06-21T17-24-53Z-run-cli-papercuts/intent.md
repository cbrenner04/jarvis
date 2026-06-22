---
name: run-cli-papercuts
---

# Run-mode papercuts: exit-reason legend, `run --help`, failed-plan cleanup

## Problem

Three small, independent friction points slowed an otherwise-smooth session driving Jarvis on a
target repo. Each is cheap; one spec, separate subspecs.

## Items

- **Opaque run exit codes.** Run summaries print an `exit reason:` line already, but the numeric
  exit *codes* have no legend; the operator inferred meanings. Add a one-line code→reason mapping
  (or ensure the reason line fully covers it) so the code is self-describing. (Verify current
  state first — partial may already exist.)
- **No `jarvis run --help`.** `--help` was parsed as a spec path (`spec path does not exist:
  …/--help`). Add a usage string for `run` (and audit the other subcommands for the same).
- **Stale `plan/*` worktrees/branches after a failed plan.** A failed plan left
  `.worktree/plan-<name>` + `plan/<name>` behind, needing manual `git worktree remove` /
  `branch -D`. Clean these up on plan failure. (Related to [[plan-git-false-boundary-misfire]].)

## Out of scope

- Reworking exit-code *values* — only documenting/surfacing them.

## Documentation updates

- `v1/docs/run-loop.md` — the exit-reason legend.
- `v2/docs/v1-behaviors.md` if any behavior (cleanup) changes.

## References

- groceries `redesign-fixups-report.md` §5.6 — source.
- `v1/src/run-summary.ts` — run summary output (exit-reason legend).

## Prerequisites

- Run mode prints a run summary including an `exit reason:` line (`v1/src/run-summary.ts`).
- A failed plan can leave `.worktree/plan-<name>` and a `plan/<name>` branch behind.
