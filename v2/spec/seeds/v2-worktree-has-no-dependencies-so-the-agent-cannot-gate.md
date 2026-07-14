# The agent's prescribed verification commands cannot install; the only command that can is forbidden

`bun run ready` installs dependencies. `bun run typecheck` and `bun run test:v2` do not. We tell the
agent to run the latter and explicitly **forbid** the former — so in a fresh v2 worktree, which has no
`node_modules`, the agent's prescribed pre-tick verification always fails on missing dependencies.

The harness then runs `ready` — with its install — *after* the agent is done. The dependencies arrive
too late to be of any use to the agent that needed them.

## The mechanism

1. A v2 worktree is created at `~/.jarvis/worktrees/<project>/<branch>/`, outside the repo. Bun's
   `node_modules` up-walk from there never reaches the project's. The worktree has no dependencies.
2. `AGENTS.md:40` instructs the agent: *"Run `bun run typecheck` … before ticking the acceptance
   criteria they cover, plus the test script(s) matching the surface(s) touched … **Do not run
   `bun run ready`** — Jarvis runs that harness gate automatically."*
3. `getReadyCommands` (`scripts/ready.ts:210-234`) pushes `bun install --frozen-lockfile` as the
   **first** step of the `full` tier whenever `shouldRunInstall` (`:194`) finds `node_modules` absent
   or the install digest stale. **`ready` is the only entrypoint that installs.**
4. `typecheck` / `test:v2` / `test:integration:v2` never install.

So the one command that would provision the worktree is the one command the agent is told not to run,
and the commands it *is* told to run cannot provision it. This is not agent error and not
nondeterminism — it is deterministic, and it is caused by our own guidance.

## Evidence

Observed 2026-07-14 across five implement runs.

**Run `ee539293`** (`workflow-routing-read-failure-surfaces-named-error`) — wrote correct code, tests,
and docs, ticked 3 of 4 criteria, then blocked:

```
## Blocker
Required verification cannot run in this checkout: `tsc` is unavailable, and
the test suite cannot resolve installed packages `react` and `js-tiktoken`.
```

**Run `454eacb1`** (`review-workflow-composition`) — same blocker, and worse: it ticked **11 of 12**
acceptance criteria, including *"tests stay green"*, on code carrying **22 typecheck errors**. It
could not have run a single check it claimed passed.

**The controlled result.** I linked the project's `node_modules` into that worktree and re-ran the
**same spec with the same agent**. It fixed all 22 errors in **one iteration** and gated itself green.
The agent was never wrong — it was blind.

**Why some worktrees do have `node_modules`.** Because `ready-finalize` ran the gate at the end of a
*completed* run, and the gate installed. The correlation is exact: worktrees whose runs completed have
a real `node_modules`; the worktrees whose runs **blocked** — and so never reached ready-finalize —
have none. The dependencies are provisioned, just strictly after the agent could have used them.

## Why this matters beyond two blocked runs

- **The gate criterion is the one that substantiates the others.** An agent ticking "typecheck and
  tests pass" from a worktree where neither can run is asserting something it did not do. That is a
  gate-trust bug of the same family as `run-cannot-report-complete-over-red-gate`, and here the
  harness *causes* it.
- **The red-gate repair loop cannot arm.** `red-gate-feeds-back-to-the-agent` only engages when a gate
  runs and returns red. A blocked run never reaches it. Consistent with `ready_gate_repair` having
  never been emitted — see `v2-run-reports-completed-over-a-red-gate`.

## Scope

- The agent's prescribed verification commands succeed in a fresh v2 worktree, with no agent action
  and no change to `AGENTS.md`'s "do not run `bun run ready`" rule.
- Provision dependencies when the worktree is created, before the first agent iteration.
- A red gate then reaches the agent's repair loop instead of blocking the run upstream of it.

## Decisions

- Provision at worktree creation, not by telling agents to `bun install` or to run `ready`. Rules out
  fixing this in guidance — the harness should not depend on the agent working around it, and
  `ready`'s install is the *completion* gate, not a setup step.
- Prefer linking/reusing the project's `node_modules` over a per-worktree `bun install`. Rules out
  paying a full resolution per run and duplicating the store per worktree; `ready`'s
  `--frozen-lockfile` install then finds the digest current and becomes a no-op.
- Do not relocate v2 worktrees into `<repo>/.worktree/`. Rules out reversing the external worktree
  home that `triage-merge-resolves-v2-worktrees` and the v2 runbook build on.
- Do not weaken the gate acceptance criteria. Rules out converting a blocked run into a silently
  unverified one.

## Out of scope

- v1 worktrees, which live inside the repo and resolve dependencies normally.
- The biome/`check` failures themselves — `red-gate-feeds-back-to-the-agent`'s job, once the gate runs.

## Documentation updates

- `v2/docs/operator-runbook.md` — delete the "No v2 run can gate its own work" gotcha, which names a
  seed (`v2-worktrees-have-no-dependencies-so-no-gate-can-run`) that does not exist.
- `v2/docs/workflow-runner.md` — state that a v2 worktree resolves project dependencies on creation.
