---
name: implement-routing-read-works-on-first-launch
---

# implement's linked-index routing read works on first launch

`jarvis run workflow implement --spec <project-root>/…/index.md` fails on first
launch with `ENOENT` opening the index inside the external worktree.
`runLinkedImplementStep` (`v2/src/execution/workflow-runner.ts`) resolves the
index against `getExternalWorktreePath(step.worktree)` and `readFileSync`s it
*before* the write loop — the thing that creates the worktree — has ever run.
Index-routed implement is the only shape the `implement` preset builds, so the
preset cannot start.

## Decisions

- Fix the runner, not the preflight; project-root-relative `--spec` is the
  operator contract and #1417 already encodes it. Rules out re-interpreting
  `--spec` as worktree-relative.
- The write loop stays the only consumer of worktree-relative paths.
- Regression coverage must start from **no worktree on disk**, spec at the
  project root, and drive `runLinkedImplementStep` to the write step. Existing
  tests pass only because they pre-create the worktree.

## Out of scope

- Live pause/kill for workflow-started implement runs.
- Error naming for routing-read failures (separate behavior).

## Documentation updates

- `v2/docs/write-behavior.md` — when the worktree is created relative to the
  first routing read.
- `v2/docs/operator-runbook.md` — confirm the "`--spec` is resolved against the
  registered project root" note now holds for the runner, not just preflight.
- `v2/docs/v1-behaviors.md` if this changes existing documented behavior.

## Prerequisites

- `jarvis run workflow implement` preflight validates `--spec` against the registered project root.
- The write loop creates the external worktree for a write step.
