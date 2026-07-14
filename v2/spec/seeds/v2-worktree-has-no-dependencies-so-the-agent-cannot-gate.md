# A v2 worktree is created without dependencies, so gating is left to the agent's initiative

The harness creates a v2 worktree at `~/.jarvis/worktrees/<project>/<branch>/` and never provisions
its dependencies. The worktree is outside the repo, so bun's `node_modules` up-walk does not reach
the project's. Whether the agent can run the verification commands it is *told* to run before ticking
acceptance criteria therefore depends on whether that particular agent thinks to run `bun install`
first.

Most do. When one doesn't, it blocks on a criterion it cannot satisfy — after doing all the work
correctly.

## Problem

Observed 2026-07-14 on `main` at `d7b36f5e`, across two implement runs in one session.

**Run `ee539293`** (`20260714T143711Z-workflow-routing-read-failure-surfaces-named-error`) wrote
correct code, correct tests, and correct docs, ticked 3 of 4 acceptance criteria, then appended:

```
## Blocker

Required verification cannot run in this checkout: `tsc` is unavailable, and
the test suite cannot resolve installed packages `react` and `js-tiktoken`.
```

The unticked criterion was the gate one. The run ended `blocked` / `agent_blocked` after 3
iterations with the work uncommitted. Linking the project's `node_modules` in and re-gating by hand:
typecheck green, `bun run ready` red on 3 mechanical biome errors, `bun run fix` cleared all 3, gate
green. **The work was correct. The agent could not see that.**

**Run `31b49a89`** (`20260714T145402Z-resume-stopped-write-run-from-snapshot`), same session, same
harness: its worktree contains a real `node_modules` and a `bun.lock` timestamped *during the run*.
That agent installed dependencies itself and gated fine.

A survey of the 14 v2 worktrees on this machine: 13 have `node_modules`, 1 does not. The harness
provisions none of them — the agents do, when they think of it. So the gate is not a harness
guarantee; it is a coin flip on agent initiative.

## Why this matters beyond one blocked run

- **The gate criterion is the one that substantiates the others.** An agent that ticks
  "`bun run typecheck` and `bun run test:v2` pass" from a worktree where neither can run is asserting
  something it did not do. Same family as `run-cannot-report-complete-over-red-gate`. Whether that
  happens currently depends on agent initiative, which is not a gate.
- **The red-gate repair loop cannot arm.** `red-gate-feeds-back-to-the-agent` shipped a bounded
  repair loop, but it only engages when a gate *runs and returns red*. When the gate cannot run, the
  run blocks upstream of it — consistent with `ready_gate_repair` never having been observed.
- Every agent that self-installs pays a full dependency resolution per worktree, per run.

## Scope

- The harness provisions dependencies when it creates a v2 worktree, so verification commands work
  before the agent's first iteration. Link/mount the project's `node_modules`, or create the worktree
  somewhere the up-walk resolves.
- `bun run typecheck` and the test scripts exit non-127 in a fresh v2 worktree, with no agent action.
- A red gate then reaches the agent's repair loop instead of blocking the run.

## Decisions

- Provision at worktree creation, not by instructing agents to `bun install`. Rules out depending on
  agent initiative for a harness guarantee — that is exactly today's nondeterministic behavior.
- Do not weaken the gate acceptance criteria. Rules out converting a blocked run into a silently
  unverified one.
- Do not relocate v2 worktrees into `<repo>/.worktree/`. Rules out reversing the external worktree
  home that `triage-merge-resolves-v2-worktrees` and the v2 runbook build on.
- Prefer linking the project's `node_modules` over a per-worktree `bun install` — the latter is slow
  and duplicates the store on every run, which is the cost agents are already paying by hand.

## Out of scope

- The biome/`check` failures themselves — `red-gate-feeds-back-to-the-agent`'s job, once the gate can run.
- v1 worktrees, which live inside the repo and resolve dependencies normally.

## Documentation updates

- `v2/docs/operator-runbook.md` — delete the "No v2 run can gate its own work" gotcha, which names a
  seed (`v2-worktrees-have-no-dependencies-so-no-gate-can-run`) that does not exist.
- `v2/docs/workflow-runner.md` — state that a v2 worktree resolves project dependencies on creation.
