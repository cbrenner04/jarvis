---
name: record-verifier-spawn-process-groups
---

# Record finalization verifier spawn process groups

## Prerequisites

- A run can durably carry multiple concurrent verifier process-group ids without overwriting earlier groups.
- Sweep-candidate listing returns every recorded group for a non-live owning run.

## Primary implementation surface

- Execution-loop finalization verifier spawns in `v2/src/execution/ready-finalize.ts`, `v2/src/execution/diff-derived-mutation-verifier.ts`, and `v2/src/execution/runtime-smoke-verifier.ts`

## Problem

Only the ready-gate and required-integration invocations record an in-flight process group on the owning run. Three sibling finalization spawns — base-ref reproduction probe, diff-derived mutation verifier scoped `bun test`, and runtime smoke `bun run <entrypoint>` — spawn detached test trees with no durable group id, so neither live termination nor daemon-startup sweep can find them after the owning run dies.

## Decision ledger

- Each of the three spawns records its process group through the same `processGroup.onGroupId` callback pattern the ready gate already uses, cleared in settlement `finally`; rules out signal-only binding without a durable id.
- Ready-gate and required-integration recording migrates to the generalized multi-group persistence API; rules out leaving those call sites on the deprecated single-column path.
- Recording is per invocation, not once for the whole finalization tail; rules out one shared id that outlives individual verifier settlement.

## Acceptance criteria

- [ ] `v2/src/execution/ready-finalize.test.ts` proves the base-ref reproduction probe records its process group on the owning run row; it fails against the current path where only the gate group is recorded.
- [ ] `v2/src/execution/diff-derived-mutation-verifier.test.ts` proves the scoped verifier `bun test` spawn records its process group; it fails against the current unrecorded spawn.
- [ ] `v2/src/execution/runtime-smoke-verifier.test.ts` proves the smoke probe spawn records its process group; it fails against the current unrecorded spawn.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — the finalization tail records a process group per verifier spawn.
- `v2/docs/v1-behaviors.md` — record durable process-group binding for base-ref probe, diff-derived verifier, and runtime smoke spawns.
