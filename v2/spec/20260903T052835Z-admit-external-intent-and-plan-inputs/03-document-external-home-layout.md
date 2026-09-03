# Document external home layout

## Problem

`install-and-config.md` documents in-repo scaffolding and project fields but not the Jarvis-owned external specs home layout or the opt-in keys that route publication there.

## Prerequisites

- `02-plan-commit-decision-parity` (document landed behavior only).

## Decision ledger

- Authoritative external-home layout lives in `install-and-config.md`; rules out duplicating the full directory tree across operator and architecture docs.
- Document `seeds/`, `ready-intents/`, `plans/<name>/`, and `plans/completed/<name>/` under `~/.jarvis/specs/<projectSafeId>/`; rules out a root-level `completed/` sibling in the external home.
- Table opt-in keys `projects.<key>.git: false` and `projects.<key>.plan.commit: false` with the same effective-commit precedence as publication; rules out implying external homes are the default for all projects.
- `workflow-runner.md` is the publication admission contract and must be updated for absolute external paths, not only cross-linked; rules out stale relative-only `--seed` / `--ready-intent` rules contradicting `00`–`02`.

## Tasks

- Add an external specs home section to `install-and-config.md` with directory layout and opt-in configuration table.
- Update `workflow-runner.md` intent and plan admission rules for absolute paths under `~/.jarvis/specs/<projectSafeId>/seeds/` and `ready-intents/`; keep plan commit precedence consistent with `02`.

## Acceptance criteria

- [ ] `v2/docs/install-and-config.md` documents external-home layout (`seeds/`, `ready-intents/`, `plans/<name>/`, `plans/completed/<name>/`) and opt-in keys in one authoritative table consistent with `00`–`02`.
- [ ] `v2/docs/workflow-runner.md` updates intent `--seed` and plan `--ready-intent` admission rules for absolute paths under the owning project's `~/.jarvis/specs/<projectSafeId>/` home and documents plan commit precedence consistent with `02`.

## Documentation updates

- None beyond the acceptance criterion above.
