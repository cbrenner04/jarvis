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
- An unrelativizable subspec path is a named failure, never a silent skip; rules out fail-soft per-entry `continue` masking a total miss.
- Outer `catch` on inventory build is a named failure, never empty lists; rules out fail-soft `catch` masking parse/read errors as zero linked subspecs.
- `SubspecCompletionInventory` carries optional `inventoryError: string`; unrelativizable paths and outer-catch failures set it with empty path lists — distinct from genuinely zero linked subspecs (empty lists, no error).
- Operator-visible failure is `inventoryError` on terminal `loop_finished` and the write-loop result when present; rules out inventory resolution failure being indistinguishable from no linked subspecs.
- `finishIterationTimeout` keeps `resumable = hasCompletedSubspec(inventory)`; `inventoryError` alone does not imply resumable and does not read as "nothing completed" when completed paths exist.
- Reported paths stay repo-relative for operators regardless of derivation root; rules out leaking absolute worktree paths into `loop_finished` output.
- `resumable` on `iteration_timeout` derives from a computed inventory; a failed resolution does not read as "nothing completed"; rules out forfeiting resume because path computation failed.

## Acceptance criteria

- [ ] `write-loop.test.ts` `buildSubspecCompletionInventory classifies linked subspecs when projectRoot differs from worktreePath` fails against the pre-fix `repoRelativeSubspecPath(projectRoot, …)` returning `undefined` for every entry.
- [ ] `write-loop.test.ts` `buildSubspecCompletionInventory reports repo-relative paths when projectRoot differs from worktreePath` fails against the pre-fix empty inventory.
- [ ] `write-loop.test.ts` `buildSubspecCompletionInventory surfaces inventoryError for unrelativizable subspec paths` fails against the pre-fix per-entry `continue`; `write-loop.test.ts` `buildSubspecCompletionInventory surfaces inventoryError when index build throws` fails against the pre-fix outer `catch` returning empty lists.
- [ ] `write-loop.test.ts` `iteration_timeout with one completed subspec is resumable` uses `projectRoot !== worktreePath` (production git-enabled layout) and fails against the pre-fix empty-inventory settlement; it settles `resumable: true` with that subspec in `completedSubspecPaths`.
- [ ] `write-loop.test.ts` `buildSubspecCompletionInventory yields empty lists without inventoryError for zero linked subspecs` passes on the pre-fix code and stays green after the change.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — `iteration_timeout with completed subspecs` is reachable; retire the implication that empty `completedSubspecPaths` means no progress.
- `v2/docs/write-behavior.md` — inventory root resolution, `inventoryError` named-failure contract, and settlement distinction from zero linked subspecs.
- `v2/docs/workflow-runner.md` — `iteration_timeout` resumability when completed subspecs exist; retire L21 "always non-resumable".
- `v2/docs/v1-behaviors.md` — record inventory relativization against the worktree root and `inventoryError` surfacing.

## Prerequisites
