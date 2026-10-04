# Document per-turn publication commit history

## Problem

Durable docs still describe v2's superseded single-commit-off-base publication (#3234), CAS-replace terminal boundaries, pre-shrink reset collapse, workflow-level suppress-per-step publish-once semantics, and write-stage `Jarvis-Agent` carry-forward on one surviving commit. Operators and implementers need one aligned account of per-turn commit preservation across intent, plan, and implement.

## Surface

`v1/docs/worktrees-and-commits.md`, `v2/docs/workflow-runner.md`, `v2/docs/write-behavior.md`, `v2/docs/v1-behaviors.md`.

## Decision ledger

- v2 publication matches v1 per-turn commit history on the published branch; rules out documenting CAS-replace off base or pre-implement reset collapse as the current contract.
- Only operator squash-merge to `main` may squash; rules out documenting harness-side squash before merge or suppress-per-step publish-once as current v2 workflow behavior.
- Retire step-vs-authorship divergence on a single CAS-replaced commit; rules out keeping #3234 carry-forward attribution or collapse attribution cadence as the current model.
- v2 `## Commits` and footer list every qualifying per-turn commit individually; rules out documenting v1 plan meta-commit grouping as v2 behavior.

## Task checklist

- Update `v1/docs/worktrees-and-commits.md`: per-turn commits on the published branch, `Jarvis-Agent`/`Jarvis-Step` per turn, monotonic commit count across boundaries, `## Commits` and footer listing every contributing agent; remove single-commit-off-base / CAS-replace / carried-forward write-agent-on-review-commit prose.
- Update `v2/docs/workflow-runner.md`: publication preserves per-turn history for intent/plan/implement; terminal boundaries append only on changes; only merge to main squashes.
- Update `v2/docs/write-behavior.md`: retire pre-shrink reset / `git reset --mixed` to pre-implement HEAD and "suppress per-step commits and publish once" workflow prose (lines documenting collapse attribution cadence).
- Update `v2/docs/v1-behaviors.md`: record v2/v1 parity on per-turn commit history, note #3234 single-commit decision superseded (2026-08-31), and replace the implement collapse attribution cadence entry (~line 525) with per-turn preservation.

## Acceptance criteria

- [x] `v1/docs/worktrees-and-commits.md` documents per-turn publication commits and retires single-commit-off-base / CAS-replace description.
- [x] `v2/docs/workflow-runner.md` documents per-turn publication commit preservation and that only merge to main may squash.
- [x] `v2/docs/write-behavior.md` retires pre-shrink reset collapse and suppress-per-step publish-once workflow prose.
- [x] `v2/docs/v1-behaviors.md` records v2/v1 parity on per-turn commit history, notes #3234 superseded, and replaces the implement collapse attribution cadence entry with per-turn preservation.

## Documentation updates

- `v1/docs/worktrees-and-commits.md`
- `v2/docs/workflow-runner.md`
- `v2/docs/write-behavior.md`
- `v2/docs/v1-behaviors.md`
