---
name: canonical-pipeline-execution-state-and-stage-claims
---

# Use canonical pipeline state and durable stage claims

**Rewritten 2026-09-05 against what landed.** The durable-claim machinery this intent originally asked for is already wired (`pipeline_stage_admission` guards dispatch), but its named acceptance test does not exist in the tree and `pipeline-execution.ts` documents deliberate bypasses of the claim path. What remains is closing the gap between the wired mechanism and the contract: every ownership decision goes through the durable claim, and one derivation owns pipeline state.

## Prerequisites

- Pipeline stages durably record their admitted entry-run ID before later execution-loop ownership decisions. (Landed.)
- [[pipeline-settlement-derives-from-run-rows]] slice 1 (`durable-run-backed-stage-settlement`) — settlement and claims land against the same seam.

## Problem

Dispatch holds a durable stage claim, but adoption, recovery, and the documented bypasses in `pipeline-execution.ts` still make ownership decisions outside it, and linear, fan-out, and in-flight callers derive pipeline state through separate precedence walks that can disagree.

## Decision ledger

- Durable `pipeline_stage_admission` guards dispatch, adoption, and recovery for the full stage partition; each documented bypass is either routed through the claim or pinned with a written rationale; rules out process-local ownership surviving as an undocumented exception.
- Claim losers re-read durable stage and run rows without dispatching or settling them; rules out concurrent writers patching the same stage.
- One pipeline-state derivation serves linear and fan-out shapes and is the source for in-flight decisions; rules out separate precedence walks.
- Existing linear and fan-out ordering outcomes remain pinned by their current tests; rules out using consolidation to redesign precedence.

## Acceptance criteria

- [ ] A `pipeline-execution.test.ts` test proves adoption of an already-dispatched stage loses the durable claim without a second dispatch or settlement — written fresh against the current tree (the previously named test does not exist); fails when the adoption path skips the claim.
- [ ] Recovery paths and each current bypass in `pipeline-execution.ts` either go through the durable claim or carry a pinned rationale; a structural check fails on an unpinned bypass.
- [ ] Existing derivation tests (`reports running when any workflow stage row reads running`, the fan-out derive cases) stay green with no assertion dropped, and in-flight callers consume the single derivation.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — durable claim ownership across dispatch, adoption, recovery; canonical derivation.
- `v2/docs/pipeline-execution.md` — retire or pin the documented bypasses.
- `v2/docs/v1-behaviors.md` — canonical state derivation and durable cross-process stage exclusion.
