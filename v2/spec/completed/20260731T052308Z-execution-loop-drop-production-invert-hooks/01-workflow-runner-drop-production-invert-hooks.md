# Workflow runner drops invert-for-test hooks

`workflow-runner.ts` threads `invertReadyGateRepairFenceForTest` through `ReviewMutationResumeDeps`
and `invertFence` into `enforcePersistedReadyGateRepairFence`.

## Decisions

- `ReviewMutationResumeDeps` loses `invertReadyGateRepairFenceForTest` — rules out keeping
  `bypassPersistedReadyGateRepairFenceForTest` in the same edit (not an `invert*` shape).
- `workflow-runner.test.ts` has no `invertReadyGateRepairFenceForTest` threading today — confirm
  production cleanup only.

## Tasks

- **workflow-runner.ts:** remove `invertReadyGateRepairFenceForTest` from `ReviewMutationResumeDeps`
  and call sites; stop threading `invertFence` into `enforcePersistedReadyGateRepairFence`.
- **workflow-runner.test.ts:** confirm production `workflow-runner.ts` carries no forbidden invert
  hooks after cleanup; leave `bypassPersistedReadyGateRepairFenceForTest` calls unchanged (not an
  `invert*` hook).
- Run `bun run typecheck` and `bun test v2/src/execution/workflow-runner.test.ts`.

## Acceptance criteria

- [x] `workflow-runner.ts` carries no `setInvert*ForTest` export, `invert*ForTest` module variable,
  `invert*` function parameter, or `invert*ForTest` type member.

## Documentation updates

- None — `write-step-rules-forbid-production-invert-hooks` owns operator-facing guard-inversion doc.
