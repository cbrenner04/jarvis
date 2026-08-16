---
name: pipeline-fan-out-lanes-serial-chained-bases
---

# Fan-out lanes run serially by default, each chained off the previous lane's implement branch

## Problem

Fan-out lanes dispatch concurrently and independently: every lane's plan bases off `main` and its implement off its own plan branch; no lane sees a sibling's work. Seed splits are usually dependent (a later intent builds on interfaces an earlier one introduces — the same chain that blocks `jarvis1 plan` across sibling intents), so the later lane either re-invents the seam or conflicts with the earlier lane's PR at merge. Ready-intents already carry `## Prerequisites` prose naming sibling dependencies, but nothing machine-readable, and the pipeline ignores it.

## Decisions

- Default lane mode is **serial, chained**: lanes run in `downstreamInputs` order (the intent's authored order); lane N+1's plan and implement worktrees base off lane N's implement branch (`prior.branch` chaining, the same seam implement already uses off plan). Lane 1 bases off `main` as today. Rules out concurrent-from-`main` as the default.
- Approval gates stay per lane; a lane's `approve-plan` blocks only that lane and its successors, never a predecessor. Rules out changing gate semantics.
- A predecessor lane's failure or rejection skips every successor lane (`skipped`, with `failureDetail` naming the failed predecessor). Rules out building on a dead base.
- Opt-in parallel: an intent lane declares independence via ready-intent frontmatter `independent: true`; independent lanes base off `main` and dispatch concurrently as today, while dependent lanes chain in order after all independent ones settle. Rules out a per-start CLI flag; the intent knows the shape.
- Terminal publication per lane (seed `pipeline-fan-out-per-lane-terminal-settlement`) is a prerequisite; with chained bases each lane's implement PR targets `main` and carries its predecessors' commits until those merge, so `terminalAction: merge` on serial lanes merges in order and later PRs shrink accordingly.

## Acceptance criteria

- [ ] A two-lane dependent split runs lane 2's plan only after lane 1's implement succeeded, with lane 2's plan and implement worktrees based off lane 1's implement branch; pinned by a pipeline-execution test that fails against current concurrent-from-`main` dispatch.
- [ ] Lane 1 failure or rejection settles lane 2's rows `skipped` naming lane 1; pinned by a test.
- [ ] Two lanes both marked `independent: true` dispatch concurrently from `main` (today's behavior); a mixed split runs the independent lanes first and chains the dependent ones after; pinned by tests.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — branch fan-out execution: serial default, chaining, `independent` marker.
- `v1/docs/spec-guidance.md` — ready-intent frontmatter `independent`.
- `v2/docs/first-workflow-walkthrough.md`, `v2/docs/operator-runbook.md` — fan-out expectations; `v2/docs/v1-behaviors.md` — record.
