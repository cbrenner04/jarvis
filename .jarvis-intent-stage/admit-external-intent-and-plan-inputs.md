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
- Intent `--seed` accepts a file under `~/.jarvis/specs/<projectSafeId>/seeds/` and consumes it on landing; rules out repo-bound seeds as the only entry point.
- Plan `--ready-intent` accepts a file under `~/.jarvis/specs/<projectSafeId>/ready-intents/`; rules out absolute-path rejection for the project's own managed home.
- Plan's commit decision honors machine-level `modes.plan.commit` the same way intent's does; rules out leaving the split where intent consults machine config and plan does not.
- External homes remain per registered project via shared `projectSafeId`; rules out a global spec pool.

## Acceptance criteria

- [ ] An intent admission test proves `--seed` under the project's external seeds home admits, lands, and consumes for an opted-in project; it fails against the current relative-path/escape guards.
- [ ] A plan admission test proves `--ready-intent` naming a file in the project's external ready-intents home admits and drafts; it fails against the current absolute-path rejection.
- [ ] A config test pins one shared commit-decision rule for intent and plan (machine-level fallback honored by both or by neither), failing against the current split.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/install-and-config.md` — external-home layout (`seeds/`, `ready-intents/`, `plans/`, `completed/`) and opt-in keys in one authoritative table.
- `v2/docs/operator-runbook.md` — external seed and ready-intent admission paths for opted-in projects; cross-link install-and-config for layout.
- `v2/docs/v1-behaviors.md` — record v2 external seed/ready-intent admission and commit-decision parity against v1.
