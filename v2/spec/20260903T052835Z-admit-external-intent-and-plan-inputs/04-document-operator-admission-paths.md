# Document operator admission paths

## Problem

`operator-runbook.md` documents in-repo seed and ready-intent queue paths and external implement admission, but not how operators pass external seeds and ready-intents into intent and plan workflows.

## Prerequisites

- `03-document-external-home-layout` (cross-link target for layout).

## Decision ledger

- Document CLI examples using absolute paths under `~/.jarvis/specs/<projectSafeId>/seeds/` and `ready-intents/` for opted-in projects; rules out implying relative repo paths are required for external queues.
- External absolute `--seed` / `--ready-intent` still require invocation `cwd` under the owning registered project (`resolveProjectMatch(input.cwd)`); rules out implying any absolute path works without project cwd binding.
- Extend queue-location guidance so the in-repo artifact table is not the sole story for opted-in projects; rules out operator confusion when external routing applies.
- Examples scope to standalone `jarvis run workflow intent|plan` only; rules out documenting `pipeline start --seed` with external absolute paths.
- Cross-link `install-and-config.md` for layout and opt-in keys; rules out duplicating the authoritative table.
- Align examples with `workflow-runner.md` publication routing without restating implement admission owned elsewhere.

## Tasks

- Add operator-runbook guidance for external intent `--seed` and plan `--ready-intent` admission paths (standalone workflows; `cwd` under owning registered project).
- Extend "Where planning artifacts live" (or equivalent) for external queue locations on opted-in projects.
- Cross-link `install-and-config.md` for external-home layout and opt-in configuration.

## Acceptance criteria

- [ ] `v2/docs/operator-runbook.md` documents external seed and ready-intent admission paths for opted-in projects (standalone `jarvis run workflow intent|plan` only; invocation `cwd` under the owning registered project; absolute paths under `~/.jarvis/specs/<projectSafeId>/`), extends queue-location guidance beyond the in-repo-only artifact table, and cross-links `install-and-config.md` for layout, consistent with `00`–`02`.

## Documentation updates

- None beyond the acceptance criterion above.
