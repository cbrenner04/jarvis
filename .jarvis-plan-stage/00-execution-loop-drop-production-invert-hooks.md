# Execution-loop production code drops invert-for-test hooks

Execution-loop and TUI modules thread `invert*ForTest` through `WriteLoopInput`, workflow-runner
deps, repair-fence helpers (`invertFence` / `invertSidecarFence`), and exported setters
(`terminal-publication`, `project-pipeline-resolution`, `external-worktree`, TUI filters) so
guard-inversion ACs pass without mutating real guards.

**Scope:** production hook removal in `v2/src/execution/**/*.ts` and `v2/src/tui/**/*.ts`
outside `*.test.ts`; rewrite guard-inversion tests to comment-checkpoint source mutations.
`intent-output.ts` already uses comment checkpoints — verify only, no new invert plumbing.

## Prerequisites

- **Write-step rules** (`write-step-rules-forbid-production-invert-hooks` merged):
  comment-checkpoint guard-inversion contract in `shared/prompts/step-rules.ts` and
  `v2/docs/test-writing.md`.
- **Daemon** (`daemon-drop-production-invert-hooks` merged): daemon production modules carry no
  forbidden invert hooks.
- **CLI** (`cli-drop-production-invert-hooks` merged): CLI production modules carry no forbidden
  invert hooks; `workflow.test.ts` already checkpoints the external-worktree lock-release guard.

## Decisions

- Strip all four forbidden hook shapes from execution-loop and TUI production — rules out retaining hooks, `invertFence` / `invertSidecarFence` parameter plumbing, or renaming to evade a future guard.
- `WriteLoopInput`, workflow-runner deps, and repair-fence helper signatures lose every `invert*ForTest` field and every `invert*` function parameter — rules out keeping `bypassPersistedReadyGateRepairFenceForTest`-style siblings in the same edit (out of scope here; not an `invert*` shape).
- Comment-checkpoint guard-inversion per `v2/docs/test-writing.md` and daemon exemplar — rules out dedicated invert `test()` / `it()` bodies that call deleted setters or pass `invert*ForTest` through loop input.
- Delete dedicated invert test blocks; add comment checkpoints on positive pinning tests naming the production guard mutation — rules out tautological `{ invertReadyGateRepairSidecarFenceForTest: true }` loop calls.
- Highest-risk guard pin: ready-gate repair sidecar fence (`findFirstHarnessSidecarBasenameViolation`) — rules out fencing only the allowed-path guard.
- `intent-output.ts`: no production invert hooks to remove; existing handoff / durable-dir comment checkpoints stay — rules out reintroducing optional invert parameters.
- Documentation updates: none — `write-step-rules-forbid-production-invert-hooks` owns operator-facing guard-inversion doc.

## Tasks

- **write-loop.ts:** remove `invertAbortWatchdogPrecedenceForTest`, `invertRepairAbortPropagationForTest`, `invertRepairJoinForTest`, `invertRepairTerminalBeforeJoinForTest`, `invertReadyGateRepairFenceForTest`, and `invertReadyGateRepairSidecarFenceForTest` from `WriteLoopInput` and call sites; drop `invertFence` / `invertSidecarFence` parameters from `findFirstHarnessSidecarBasenameViolation`, `findFirstRepairFenceViolation`, `validateReadyGateRepairCompletion`, and `enforcePersistedReadyGateRepairFence` (retain `bypass` only on the persisted-enforcement options bag).
- **workflow-runner.ts:** remove `invertReadyGateRepairFenceForTest` from resume/finalization deps; stop threading `invertFence` into `enforcePersistedReadyGateRepairFence`.
- **terminal-publication.ts:** remove three `invert*ForTest` module variables and `setInvert*ForTest` exports; inline real guards.
- **project-pipeline-resolution.ts:** remove `invertTerminalActionConflictGuardForTest` and `setInvertTerminalActionConflictGuardForTest`; inline real guard.
- **external-worktree.ts:** remove `invertExternalWorktreeLockReleaseForTest` and `setInvertExternalWorktreeLockReleaseForTest`; always release lock in `finally`.
- **tui-monitor-terminal-window.ts:** remove two `invert*ForTest` module variables and `setInvert*ForTest` exports; inline real filter/cap guards.
- **write-loop.test.ts:** delete `inverting repair $label breaks held-repair settlement for killed` `test.each` block and `abort-vs-watchdog guard inversion: watchdog-first flips to progress when precedence is inverted`; remove unfenced repair-fence cases that pass `invertReadyGateRepairFenceForTest` / `invertReadyGateRepairSidecarFenceForTest`; add comment checkpoints on positive pinning tests:
  - held-repair settlement (killed terminal) — mutations on abort-propagation, invocation-join, and terminal-ordering guards in `write-loop.ts`;
  - `rejects ready-gate repairs outside the run diff and spec tree` — mutation: remove `!allowedPaths.has(normalized)` rejection in `findFirstRepairFenceViolation`;
  - `rejects ready-gate repairs that would publish harness sidecars` — mutation: remove `basename(normalized).startsWith(".jarvis-")` rejection in `findFirstHarnessSidecarBasenameViolation`;
  - abort-vs-watchdog positive case (`watchdog-first` ordering settles `iteration_timeout`) — mutation: flip `resolveIterationSettlementKind` precedence mapping.
- **workflow-runner.test.ts:** drop any `invertReadyGateRepairFenceForTest` threading; leave `bypassPersistedReadyGateRepairFenceForTest` calls unchanged (not an `invert*` hook).
- **terminal-publication.test.ts:** delete `describe("terminal publication guard inversion")` and setter imports/resets; add comment checkpoints on `does not ready-flip or merge after a red ready gate`, `executes each terminal action type once against fake publication` (leave-draft path), and `retains PR evidence on ready gate failure` naming mutations on the red-gate, leave-draft no-mutation, and failure-preservation guards.
- **project-pipeline-resolution.test.ts:** delete `inverting terminal-action conflict guard admits pipelines without an implement workflow stage`; add comment checkpoint on `rejects terminal-action approval conflicts` naming mutation on the `lacksImplementStage` guard branch.
- **tui-monitor-terminal-window.test.ts:** delete `inverted window filter surfaces terminal runs finished more than one hour ago` and `inverted row cap shows every in-window terminal run`; add comment checkpoints on `renders in-window terminal rows in finish order, capped at twenty, and keeps old active rows` (window filter and row-cap guards) and on `retains non-terminal rows and caps terminal rows by finish time`.
- Run `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2`.

## Acceptance criteria

- [ ] `v2/src/execution/**/*.ts` and `v2/src/tui/**/*.ts` outside `*.test.ts` carry no `setInvert*ForTest` export, `invert*ForTest` module variable, `invert*` function parameter, or `invert*ForTest` type member.
- [ ] `write-loop.test.ts` — unfenced repair-fence cases that pass `invertReadyGateRepairFenceForTest: true` or `invertReadyGateRepairSidecarFenceForTest: true` are removed; `rejects ready-gate repairs that would publish harness sidecars` carries a comment checkpoint naming the `findFirstHarnessSidecarBasenameViolation` mutation (fails against pre-change tests that rely on the invert input field).
- [ ] In `write-loop.test.ts`, the documented `findFirstHarnessSidecarBasenameViolation` mutation turns `rejects ready-gate repairs that would publish harness sidecars` RED. (Manual)
- [ ] `write-loop.test.ts` — `rejects ready-gate repairs that would publish harness sidecars` stays green.
- [ ] `write-loop.test.ts` — `rejects ready-gate repairs outside the run diff and spec tree` stays green.
- [ ] `terminal-publication.test.ts` — `does not ready-flip or merge after a red ready gate` stays green.
- [ ] `project-pipeline-resolution.test.ts` — `rejects terminal-action approval conflicts` stays green.
- [ ] `tui-monitor-terminal-window.test.ts` — `renders in-window terminal rows in finish order, capped at twenty, and keeps old active rows` stays green.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- None — shared guard-inversion doc already updated by `write-step-rules-forbid-production-invert-hooks`.
