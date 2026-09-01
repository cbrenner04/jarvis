---
name: sweep-v2-unreferenced-exports
---

# Sweep unreferenced v2 exports under the hygiene gate

Fully dead exports remain under the hygiene gate and roughly two hundred additional exported symbols are referenced only inside their defining file; carrying that surface under a green gate would negate the new check.

## Primary implementation surface

- Production modules under `v2/src/`

## Behavior

- Delete every export the dead-export gate reports as fully dead under its production scan scope (`cleanupVerdictFile` is the known production symbol; `isWriteLoopOutcomeKind` is not — `state-store.ts` imports it).
- Delete fully dead exports under `v2/src/testing/` enumerated at sweep time (`registerStopPoll`, `createHoldableAsyncSubprocessRunner`, and any others with zero importers repo-wide).
- Demote every export referenced nowhere outside its own file to module-private in one mechanical sweep with zero behavior change.

## Decision ledger

- Delete only exports with zero importers anywhere in the repo; rules out demoting symbols that are dead only outside their file and deleting `isWriteLoopOutcomeKind` while `state-store.ts` still imports it.
- Demote unreferenced-outside-own-file exports without renaming or moving symbols; rules out API reshaping bundled into hygiene work.
- Land demotion as one sweep so `bun run check` is green immediately after merge; rules out a phased per-package rollout.

## Acceptance criteria

- [ ] Gate-reported fully-dead production exports plus `registerStopPoll` and `createHoldableAsyncSubprocessRunner` are absent from `v2/src`, pinned by `scripts/guard-dead-exports.test.ts` or a focused regression test.
- [ ] `bun run check` is green after the demotion sweep with no new allowlist entries beyond those from the gate intent.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.
- [ ] `v2/src/execution/workflow-runner-core.test.ts`, `write-loop.test.ts`, and `scripts/guard-dead-exports.test.ts` stay green (behavior unchanged by export demotion).

## Documentation updates

- None — export hygiene gate documentation lands in the gate intent.

## Prerequisites

- A dead/unreferenced export hygiene gate runs in `bun run check` with an explicit allowlist for intentional public surface.
