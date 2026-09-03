---
name: pipeline-external-chained-resolution
---

# Pipeline resolves external chained artifacts and surfaces fan-out lane failures

## Prerequisites

- Intent `--seed` admits, lands, and consumes seeds under `~/.jarvis/specs/<safeId>/seeds/` for opted-in projects.
- Plan `--ready-intent` admits ready-intents under `~/.jarvis/specs/<safeId>/ready-intents/` for opted-in projects.
- Intent and plan share one commit-decision rule honoring machine-level `modes.plan.commit`.
- Chained-stage dispatch resolves external workspaces for git-disabled projects (`match-git-disabled-chained-stage-workspaces`).

## Module-boundary surface

- Daemon: chained stage resolution in `v2/src/daemon/pipeline-stage-resolve.ts` and operator-incident derivation in `v2/src/daemon/operator-incidents.ts`.

## Problem

Pipeline `pipeline-stage-resolve` still validates prior-stage downstream inputs with `gitPathExistsOnBranch` for the intent→plan hop, so externally landed ready-intents fail even when present on disk under the project's external home. Separately, a fan-out lane whose stage settles `failed` while sibling lanes keep the pipeline non-terminal emits no operator incident naming its `branchKey` — the failure is silent behind the next lane's gate (#3374).

## Decisions

- Pipeline stage-resolve accepts a prior stage's downstream input by filesystem existence when it resolves under the owning project's external home, using the same predicate `resolveImplementStage` applies; rules out point-fixing only the implement hop or keeping `gitPathExistsOnBranch` for external paths.
- A fan-out lane whose stage settles `failed` while the pipeline remains non-terminal derives an operator incident carrying its `branchKey`; rules out relying on pipeline-level terminal incidents alone.
- External homes remain per registered project via shared `projectSafeId`; rules out a global spec pool.

## Acceptance criteria

- [ ] A pipeline stage-resolution test proves an intent stage's external ready-intent path resolves for the chained plan stage on a `plan.commit: false` project; it fails against the current `gitPathExistsOnBranch` guard.
- [ ] An operator-notification test proves a fan-out lane's `failed` stage on a still-live pipeline derives an incident naming its `branchKey`; it fails against the current pipeline-level-only derivation.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — chained intent→plan handoff for external ready-intents on opted-in projects; fan-out lane failure incidents.
- `v2/docs/daemon-host.md` — external downstream-input resolution predicate for chained stages; stage incident `branchKey` on non-terminal fan-out failures.
- `v2/docs/v1-behaviors.md` — record v2 external chained-resolution and fan-out incident behavior.
