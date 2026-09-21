---
name: cleanup-archives-hand-landed-specs
---

# Cleanup archives a hand-landed spec that has no run row

Stranded-artifact inspection keys archival to a durable implementation branch resolved by matching `store.listRuns()` against the artifact's spec source. A spec authored and implemented by hand never produced a run row, so cleanup reports `no durable implementation branch` on every pass even when the work merged; the operator archives it by hand with `git mv`. Widen eligibility only for in-repository artifacts whose source is under the registered project's primary checkout: when no run row resolves for one, cleanup archives it if every linked subspec in its primary-checkout `index.md` has no unchecked non-human-only acceptance criteria and no materialized worktree in any registered project contains its source path. Index routing checkboxes do not determine completeness. External plan trees retain the current run-row requirement because they have no primary-checkout source. When a run row exists but resolves no branch, the current skip stands. Preview and apply report the archive like any other stranded artifact.

Unsplit rationale: the change is confined to cleanup's stranded-artifact eligibility path, a single module-boundary surface, so no dependency-ordered split exists.

## Primary implementation surface

- `v2/src/commands/cleanup.ts` — stranded-artifact eligibility and skip reporting

## Prerequisites

- `jarvis cleanup` discovers stranded spec artifacts and archives eligible ones to `<targetDir>/completed/`
- cleanup refuses to archive a spec owned by a materialized worktree

## Documentation updates

- `v2/docs/operator-runbook.md` — § Cleanup: hand-landed specs archive without a run row.
- `v2/docs/v1-behaviors.md` — record the widened stranded eligibility.
