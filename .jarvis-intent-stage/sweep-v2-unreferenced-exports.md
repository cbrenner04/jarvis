---
name: sweep-v2-unreferenced-exports
---

# Sweep unreferenced v2 exports under the hygiene gate

Six exports are fully dead and roughly two hundred additional exported symbols are referenced only inside their defining file; carrying that surface under a green gate would negate the new check.

## Primary implementation surface

- Production modules under `v2/src/`

## Behavior

- Delete the six fully dead exports (`isWriteLoopOutcomeKind`, `cleanupVerdictFile`, `describeInertHeadline`, and the three in `testing/`).
- Demote every export referenced nowhere outside its own file to module-private in one mechanical sweep with zero behavior change.

## Decision ledger

- Delete only exports with zero importers anywhere in the repo; rules out demoting symbols that are dead only outside their file.
- Demote unreferenced-outside-own-file exports without renaming or moving symbols; rules out API reshaping bundled into hygiene work.
- Land demotion as one sweep so `bun run check` is green immediately after merge; rules out a phased per-package rollout.

## Acceptance criteria

- [ ] The six named dead exports are absent from `v2/src`, pinned by `scripts/guard-dead-exports.test.ts` or a focused regression test.
- [ ] `bun run check` is green after the demotion sweep with no new allowlist entries beyond those from the gate intent.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.
- [ ] `v2/src/execution/workflow-runner-core.test.ts`, `write-loop.test.ts`, and `scripts/guard-dead-exports.test.ts` stay green (behavior unchanged by export demotion).

## Documentation updates

- None — export hygiene gate documentation lands in the gate intent.

## Prerequisites

- A dead/unreferenced export hygiene gate runs in `bun run check` with an explicit allowlist for intentional public surface.
