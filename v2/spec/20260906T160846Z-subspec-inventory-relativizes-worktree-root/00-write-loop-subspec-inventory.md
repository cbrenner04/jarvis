# 00 - Write-loop subspec inventory

## Primary implementation surface

execution-loop — `buildSubspecCompletionInventory` and `iteration_timeout` resumable settlement in `v2/src/execution/write-loop.ts`

## Problem

`buildSubspecCompletionInventory` resolves each linked subspec inside the managed worktree, then calls `repoRelativeSubspecPath(projectRoot, resolvedPath)`. When `projectRoot` is the operator checkout and the worktree lives under `~/.jarvis/worktrees/`, every relative path escapes (`..`-prefixed), hits the per-entry `continue`, and both lists return empty. `hasCompletedSubspec` gates `finishIterationTimeout` `resumable`, so `iteration_timeout` is non-resumable by construction and the operator-runbook completed-subspec recovery cannot fire. Outer `catch` and per-entry skip mask parse/read failures the same way.

## Decision ledger

- Inventory relativizes against `worktreePath` (the root subspecs live under), not `projectRoot`; rules out a repo-relative conversion that always fails for managed worktrees.
- `projectRoot` stays on the `buildSubspecCompletionInventory` signature for call-site compatibility but is not used to relativize resolved paths; rules out a second conversion step or deleting the parameter ad hoc.
- Any unrelativizable path or outer `catch` yields `inventoryError` with empty `completedSubspecPaths` and `remainingSubspecPaths`; rules out partial per-entry failure with mixed paths and error.
- An unrelativizable subspec path is a named failure, never a silent skip; rules out fail-soft per-entry `continue` masking a total miss.
- Outer `catch` on inventory build is a named failure, never empty lists; rules out fail-soft `catch` masking parse/read errors as zero linked subspecs.
- `SubspecCompletionInventory` carries optional `inventoryError: string`; unrelativizable paths and outer-catch failures set it with empty path lists — distinct from genuinely zero linked subspecs (empty lists, no error).
- Operator-visible failure is `inventoryError` on terminal `loop_finished`, `WriteLoopResult`, and composed `RunOperatorError` on `list`/`wait`; rules out inventory resolution failure being indistinguishable from no linked subspecs.
- `finishIterationTimeout` keeps `resumable = hasCompletedSubspec(inventory)`; `inventoryError` alone does not imply resumable.
- Reported paths stay repo-relative for operators regardless of derivation root; rules out leaking absolute worktree paths into `loop_finished` output.
- Empty `link.path` skip and `readFileSync` failure → `remaining` stay out of scope for this bugfix; rules out reading "never silent skip" as blanket inventory hardening.
- Forward-fix only: runs that settled `iteration_timeout` with `resumable: false` and empty inventory before deploy stay non-resumable; rules out retroactive resume admission.

## Tasks

- Relativize inventory entries against `worktreePath` only; keep reported paths repo-relative (worktree-root-relative in the managed-worktree layout).
- Add `inventoryError` to `SubspecCompletionInventory`; on unrelativizable path or outer `catch`, set it with empty `completedSubspecPaths` and `remainingSubspecPaths`.
- Surface `inventoryError` on `finishIterationTimeout` terminal `loop_finished` and `WriteLoopResult`.
- Echo recomputed inventory and `inventoryError` on idempotent `iteration_timeout` replay in `committedResult` (~`write-loop.ts:2491`).
- Extend `LoopFinishedEvent`, `RunOperatorError`, and `mapFromLoopFinished` to project `inventoryError` on `list`/`wait` (mirror `completedSubspecPaths` / `idle_output_timeout` projection pattern).
- Update `buildSubspecCompletionInventory` JSDoc from "fail-soft to empty lists" to the named-failure contract.
- Add unit tests for classification, repo-relative output, named failures, zero-linked-subspec baseline, and `committedResult` replay; update `iteration_timeout with one completed subspec is resumable` to use `projectRoot !== worktreePath`. Unrelativizable-path fixture: index link whose resolved absolute path escapes `worktreePath` relativization (e.g. absolute path outside the worktree).
- Add `run-operator-error.test.ts` coverage for `inventoryError` projection on `iteration_timeout`.
- Align operator and harness docs with inventory root resolution, `inventoryError`, conditional `iteration_timeout` resumability, and daemon `list`/`wait` projection.

## Acceptance criteria

- [ ] `write-loop.test.ts` `buildSubspecCompletionInventory classifies linked subspecs when projectRoot differs from worktreePath` fails against the pre-fix `repoRelativeSubspecPath(projectRoot, …)` returning `undefined` for every entry.
- [ ] `write-loop.test.ts` `buildSubspecCompletionInventory reports repo-relative paths when projectRoot differs from worktreePath` fails against the pre-fix empty inventory.
- [ ] `write-loop.test.ts` `buildSubspecCompletionInventory surfaces inventoryError for unrelativizable subspec paths` fails against the pre-fix per-entry `continue`; fixture uses an index link whose resolved absolute path escapes `worktreePath` relativization.
- [ ] `write-loop.test.ts` `buildSubspecCompletionInventory surfaces inventoryError when index build throws` fails against the pre-fix outer `catch` returning empty lists.
- [ ] `write-loop.test.ts` `iteration_timeout with one completed subspec is resumable` uses `projectRoot !== worktreePath` (production git-enabled layout) and fails against the pre-fix empty-inventory settlement; it settles `resumable: true` with that subspec in `completedSubspecPaths`.
- [ ] `write-loop.test.ts` `committedResult echoes recomputed iteration_timeout inventory with divergent roots` fails against pre-fix re-entry that passes collapsed roots or drops `inventoryError`; when resolution fails it echoes `inventoryError` on `WriteLoopResult`, when `hasCompletedSubspec` is true it returns `null`.
- [ ] `write-loop.test.ts` `buildSubspecCompletionInventory yields empty lists without inventoryError for zero linked subspecs` stays green.
- [ ] `run-operator-error.test.ts` `composeRunOperatorError projects iteration_timeout inventoryError` fails against baseline `mapFromLoopFinished` that omits `inventoryError`; composed error carries `inventoryError` from the terminal `loop_finished` row.
- [ ] `v2/docs/operator-runbook.md` documents that `iteration_timeout with completed subspecs` recovery is reachable on managed worktrees and that empty `completedSubspecPaths` with `inventoryError` is an inventory-resolution failure, not proof of no progress.
- [ ] `v2/docs/write-behavior.md` documents inventory root resolution against the worktree, the `inventoryError` named-failure contract, and the distinction from genuinely zero linked subspecs.
- [ ] `v2/docs/workflow-runner.md` documents conditional `iteration_timeout` resumability when completed subspecs exist; retires the line that timeout always ends non-resumable.
- [ ] `v2/docs/v1-behaviors.md` records inventory relativization against the worktree root and `inventoryError` surfacing on terminal `iteration_timeout` and daemon projection.
- [ ] `v2/docs/daemon-host.md` documents `inventoryError` on `list`/`wait` for `iteration_timeout` alongside existing resumability and completion-inventory projection.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/operator-runbook.md` — `iteration_timeout with completed subspecs` is reachable; retire the implication that empty `completedSubspecPaths` means no progress.
- `v2/docs/write-behavior.md` — inventory root resolution, `inventoryError` named-failure contract, and settlement distinction from zero linked subspecs.
- `v2/docs/workflow-runner.md` — `iteration_timeout` resumability when completed subspecs exist; retire L21 "always non-resumable".
- `v2/docs/v1-behaviors.md` — record inventory relativization against the worktree root and `inventoryError` surfacing.
- `v2/docs/daemon-host.md` — `inventoryError` projection on `list`/`wait` for `iteration_timeout`.
