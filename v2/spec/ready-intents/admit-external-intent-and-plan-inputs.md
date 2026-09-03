---
name: admit-external-intent-and-plan-inputs
---

# Admit external intent seeds and plan ready-intents for opted-in projects

## Prerequisites

- Chained-stage dispatch resolves external workspaces for git-disabled projects (`match-git-disabled-chained-stage-workspaces`).
- Implement admits external plan trees at the canonical `~/.jarvis/specs/<safeId>/plans/<name>/index.md` path (`implement-admits-externally-landed-specs`).

## Module-boundary surface

- Execution-loop: intent and plan publication admission in `v2/src/execution/publication-workflow-steps.ts`.

## Problem

Opted-in projects publish ready-intents and plan trees externally, but intent `--seed` still rejects absolute paths and escape checks scoped to the registered repo root, and plan `--ready-intent` rejects absolute paths — so externally landed seeds and ready-intents cannot enter the publication workflows. Plan's commit decision also ignores machine-level `modes.plan.commit` while intent's honors it.

## Decisions

- Opt-in stays the contract (`plan.commit: false` / `git: false` per project); rules out flipping the in-repo default or relocating existing projects.
- External-home layout under `~/.jarvis/specs/<projectSafeId>/`: `seeds/`, `ready-intents/`, `plans/<name>/`, and `plans/completed/<name>/` for archived plan trees; rules out a root-level `completed/` sibling in the external home (in-repo `v2/spec/completed/` remains unchanged).
- Intent `--seed` accepts a file under `~/.jarvis/specs/<projectSafeId>/seeds/` and consumes it on landing; rules out repo-bound seeds as the only entry point.
- Plan `--ready-intent` accepts a file under `~/.jarvis/specs/<projectSafeId>/ready-intents/`; rules out absolute-path rejection for the project's own managed home.
- Plan's commit decision honors machine-level `modes.plan.commit` the same way intent's does; rules out leaving the split where intent consults machine config and plan does not.
- External homes remain per registered project via shared `projectSafeId`; rules out a global spec pool.

## Acceptance criteria

- [ ] `intent-workflow-steps.test.ts` test `admits external seed under project specs home` asserts `--seed` naming a file under `~/.jarvis/specs/<safeId>/seeds/` admits, lands to external `ready-intents/`, and consumes the seed for a `git: false` project; it fails against the current relative-path and project-root escape guards in `resolveSeed`.
- [ ] `plan-workflow-steps.test.ts` test `admits external ready-intent under project specs home` asserts `--ready-intent` naming a file under `~/.jarvis/specs/<safeId>/ready-intents/` drafts to external `plans/<name>/` for a `plan.commit: false` project; it fails against the current absolute-path rejection in `planSource`.
- [ ] `publication-workflow-steps.test.ts` test `plan commit decision honors machine modes.plan.commit like intent` asserts plan's publish decision falls back to `modes.plan.commit` when project `plan.commit` is unset; it fails against the current plan-only `?? true` split in `planSource`.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/install-and-config.md` — external-home layout (`seeds/`, `ready-intents/`, `plans/<name>/`, `plans/completed/<name>/`) and opt-in keys in one authoritative table.
- `v2/docs/operator-runbook.md` — external seed and ready-intent admission paths for opted-in projects; cross-link install-and-config for layout.
- `v2/docs/v1-behaviors.md` — record v2 external seed/ready-intent admission and commit-decision parity against v1.

## Primary implementation surface

v2/src/execution/publication-workflow-steps.ts
