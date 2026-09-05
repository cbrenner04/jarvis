---
name: remove-ready-gate-repair-fence-bypass-from-production
---

# Remove the ready-gate repair-fence bypass from production code

`bypassPersistedReadyGateRepairFenceForTest` threads through `WriteLoopInput`, workflow-runner deps, and persisted-fence enforcement so tests can disable a safety fence from production call paths.

## Primary implementation surface

- `v2/src/execution/write-loop.ts` and `v2/src/execution/workflow-runner.ts`

## Behavior

- No production type or call path carries `bypassPersistedReadyGateRepairFenceForTest` or an equivalent persisted-fence bypass flag.
- Tests that needed the bypass restructure around injected seams or checkpoint mutations without shipping an off-switch in product code.

## Decision ledger

- Remove the bypass field from production types and delete production call sites that read it; rules out renaming to evade `invert*` guards while keeping a fence off-switch.
- Restructure tests with dependency-injection seams or `Mutation checkpoint:` source mutations per `v2/docs/test-writing.md`; rules out retaining a production `ForTest` bypass parameter.
- Keep persisted ready-gate repair fence enforcement always on in production; rules out making the fence optional behind a runtime flag.

## Acceptance criteria

- [ ] A new grep-level structural guard fails against the pre-fix tree where `bypassPersistedReadyGateRepairFenceForTest` is still present in production `v2/src/execution/**/*.ts` outside `*.test.ts`, and passes after removal; `scripts/guard-production-test-flags.test.ts` stays green throughout.
- [ ] `v2/src/execution/workflow-runner-resume.test.ts` ready-gate repair fence cases stay green after bypass removal.
- [ ] `v2/src/execution/write-loop.test.ts` repair-fence rejection tests stay green.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/coding-standards.md` — append no `ForTest` safety-fence bypasses in production types or call paths (preserve prior intent sections).
- `v2/docs/test-writing.md` — how ready-gate repair fence tests avoid production bypass flags.

## Prerequisites

- [[ready-gate-repair-out-of-diff-edits]] has landed (revert-on-refusal + non-resumable settlement) — same enforcement code in `write-loop.ts`/`workflow-runner.ts`; sequenced 2026-09-05 to avoid two runs racing on the fence.
