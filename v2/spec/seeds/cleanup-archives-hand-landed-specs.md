---
name: cleanup-archives-hand-landed-specs
---

# A spec landed without a Jarvis run never archives

## Problem

Stranded open-home archival keys a completed spec to a durable implementation branch through `recordedStrandedBranch`, which walks `store.listRuns()` for a run whose resolved spec source matches the artifact. A spec written and implemented by hand — no `jarvis run` ever touched it — has no run row, so `jarvis cleanup` reports `Skipped artifact: <spec> — no durable implementation branch` forever, even with every index box ticked and the implementation merged. Observed 2026-09-09: eight hand-landed specs, all 100% ticked and merged, skipped on two cleanup passes and archived by hand (`git mv` in an archive PR).

The ownership check needs the branch to refuse when a worktree still owns the spec; but a spec with no run row has no branch to own, and the merged-PR check that gates archival could be satisfied another way (the spec's own files reachable on `main` at a commit whose PR merged, or simply absence of any open worktree containing the spec).

## Decisions

- A completed spec with no durable run row is archivable when no materialized worktree in any registered project contains its source path and its `index.md` is fully ticked on the primary checkout; rules out a permanent `no durable implementation branch` skip for hand-landed work.
- The skip reason for a spec that has a run row but no resolvable branch stays as today; only the no-row case changes; rules out weakening the ownership refusal.
- Preview and apply report the archive like any other stranded artifact.

## Acceptance criteria

- [ ] A cleanup test proves a fully ticked spec directory with no run row and no owning worktree is previewed and archived; it fails against the current `no durable implementation branch` skip.
- [ ] A cleanup test proves the same spec is still skipped while a materialized worktree contains it.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — § Cleanup: hand-landed specs archive without a run row.
- `v2/docs/v1-behaviors.md` — record the widened stranded eligibility.
