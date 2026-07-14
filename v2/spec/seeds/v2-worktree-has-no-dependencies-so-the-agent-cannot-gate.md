# A v2 run's agent cannot run any gate inside its own worktree

A v2 worktree lives at `~/.jarvis/worktrees/<project>/<branch>/`, outside the repo. Bun's
`node_modules` up-walk from there never reaches the project's, so **every** verification command the
agent is told to run before ticking acceptance criteria fails on missing dependencies — not on the
code.

The agent is instructed to verify before ticking. It cannot. So it either blocks on an acceptance
criterion it can never satisfy, or it ticks the criterion untested. Both have been observed.

## Problem

Observed 2026-07-14 on `main` at `d7b36f5e`. Implement run
`ee539293` (spec `20260714T143711Z-workflow-routing-read-failure-surfaces-named-error`) wrote correct
code, correct tests, and correct docs, ticked 3 of 4 acceptance criteria, then appended:

```
## Blocker

Required verification cannot run in this checkout: `tsc` is unavailable, and
the test suite cannot resolve installed packages `react` and `js-tiktoken`.
```

The unticked criterion was the gate one — *"`bun run typecheck`, `bun run test:v2`, and
`bun run test:integration:v2` pass."* The run consumed 3 iterations and ended `blocked` /
`agent_blocked` with the work uncommitted in the worktree.

The work was fine. Symlinking the project's `node_modules` into the worktree and re-running the
gate by hand: typecheck green, `bun run ready` red on **3 mechanical biome errors**, `bun run fix`
cleared all 3, gate green. The agent was never able to see any of that.

## Why this is worse than one blocked run

- **The failing criterion is the only one that proves the others.** An agent that ticks
  "tests pass" from inside a dependency-less worktree is asserting something it could not have run.
  This is the mechanism behind agents ticking untested criteria, and it is a gate-trust bug of the
  same family as `run-cannot-report-complete-over-red-gate`.
- **The red gate is never handed to the agent.** `red-gate-feeds-back-to-the-agent` shipped a bounded
  repair loop, but it only arms when a gate *runs and comes back red*. Here the gate cannot run at
  all, so the run blocks upstream of the repair loop and the repair loop stays unexercised — which is
  consistent with `ready_gate_repair` never having been observed.
- It interacts with `acceptance-criteria-must-be-satisfiable-by-the-agent`: a gate criterion is
  satisfiable in principle, just not from where the agent stands.

## Scope

- An agent invoked in a v2 worktree can run the project's verification commands.
- Resolve dependencies for the worktree — link/mount the project's `node_modules` into
  `~/.jarvis/worktrees/<project>/<branch>/` at worktree creation, or create v2 worktrees somewhere
  the up-walk resolves.
- Whatever the mechanism, `bun run typecheck` and the test scripts must exit non-127 inside a fresh
  v2 worktree, and a red gate must reach the agent's repair loop rather than blocking the run.

## Decisions

- Fix it at worktree creation, not by weakening the acceptance criteria. Rules out telling agents to
  skip verification, which would convert a blocked run into a silently-unverified one.
- Do not relocate v2 worktrees into `<repo>/.worktree/` as the fix. Rules out reversing the external
  worktree home that `triage-merge-resolves-v2-worktrees` and the v2 runbook already build on.
- Symlinking the project `node_modules` is the cheap candidate; the spec picks the mechanism. Rules
  out a per-worktree `bun install` (slow, and duplicates the store on every run).

## Out of scope

- The `check`/biome failures themselves — those are `red-gate-feeds-back-to-the-agent`'s job once the
  gate can actually run.
- v1 worktrees, which live inside the repo and resolve dependencies normally.

## Documentation updates

- `v2/docs/operator-runbook.md` — delete the "No v2 run can gate its own work" gotcha, which
  currently names a seed (`v2-worktrees-have-no-dependencies-so-no-gate-can-run`) that does not exist.
- `v2/docs/workflow-runner.md` — state that a v2 worktree resolves project dependencies.
