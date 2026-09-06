---
name: subspec-inventory-relativizes-worktree-root
---

# Subspec completion inventory relativizes against the worktree root

## Primary implementation surface

execution-loop — `buildSubspecCompletionInventory` and `iteration_timeout` resumable settlement in `v2/src/execution/write-loop.ts`

Unsplit rationale: Inventory root resolution, named-failure contract, and timeout resumability are one write-loop settlement contract; no other module-boundary surface owns subspec path relativization or `hasCompletedSubspec` gating.

## Problem

`buildSubspecCompletionInventory` resolves linked subspecs inside the managed worktree but relativizes against `projectRoot`. For git-enabled runs those differ, every entry is silently dropped, both lists stay empty, and `iteration_timeout` is non-resumable by construction — the documented `iteration_timeout with completed subspecs` recovery never fires.

## Decision ledger

- Inventory relativizes against the root subspecs live under (the materialized worktree), not `projectRoot`; rules out a repo-relative conversion that always fails for managed worktrees.
- An unrelativizable subspec path is a named failure, never a silent skip; rules out fail-soft `continue` masking a total miss.
- Reported paths stay repo-relative for operators regardless of derivation root; rules out leaking absolute worktree paths into `loop_finished` output.
- `resumable` on `iteration_timeout` derives from a computed inventory; a failed resolution does not read as "nothing completed"; rules out forfeiting resume because path computation failed.

## Acceptance criteria

- [ ] A `write-loop` test proves `buildSubspecCompletionInventory` classifies subspecs correctly when the index lives in a managed worktree and `projectRoot` is a different directory; it fails against the current `repoRelativeSubspecPath(projectRoot, …)` returning `undefined` for every entry.
- [ ] A test proves the returned paths are repo-relative (no absolute worktree prefix) in that same case.
- [ ] A test proves an unrelativizable subspec path surfaces a named failure rather than being silently skipped; it fails against the current `continue`.
- [ ] A test proves an `iteration_timeout` after one linked subspec's non-human-only criteria are fully ticked settles `resumable: true` and lists that subspec in `completedSubspecPaths`; it fails against the current empty-inventory settlement.
- [ ] A test proves a spec with genuinely zero linked subspecs still yields empty lists without a failure.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — `iteration_timeout with completed subspecs` is reachable; retire the implication that empty `completedSubspecPaths` means no progress.
- `v2/docs/write-behavior.md` — inventory root resolution and the named-failure contract.
- `v2/docs/v1-behaviors.md` — record inventory relativization against the worktree root.

## Prerequisites
