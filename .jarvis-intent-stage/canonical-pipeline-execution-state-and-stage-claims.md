---
name: canonical-pipeline-execution-state-and-stage-claims
---

# Use canonical pipeline state and durable stage claims

## Prerequisites

- Persistence idempotently maps terminal durable workflow rows onto every linked running stage, including terminal status, artifacts, publication evidence, and failure detail, while leaving live runs unchanged.

## Module-boundary surface

- Execution loop: stage admission/adoption and pipeline-state derivation.

## Problem

Pipeline execution guards one stage row with both durable admission and process-local claims, while linear, fan-out, and in-flight decisions duplicate status precedence and can disagree.

## Decision ledger

- Durable `pipeline_stage_admission` guards dispatch, adoption, and recovery for the full stage partition; rules out process-local ownership of adoption or settlement.
- Claim losers re-read durable stage and run rows without dispatching or settling them; rules out concurrent writers waiting on and patching the same stage.
- One pipeline-state derivation serves linear and fan-out shapes and is the source for in-flight decisions; rules out separate precedence walks and predicate-specific status interpretations.
- Existing linear and fan-out ordering outcomes remain pinned by their current tests; rules out using consolidation to redesign precedence.

## Acceptance criteria

- [ ] A concurrency regression proves adoption of an already-dispatched stage is refused by the durable claim and fails against the pre-fix process-local claim path.
- [ ] Dispatch, adoption, and recovery use the durable stage claim; process-local same-row claim code is absent.
- [ ] Linear and fan-out derivation tests exercise one implementation with no assertion dropped, and existing state outcomes stay green.
- [ ] Pipeline and stage in-flight callers consume the canonical derivation instead of independent status predicates.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — durable claim ownership across dispatch, adoption, and recovery; canonical state and in-flight derivation.
- `v2/docs/state-store.md` — broaden durable stage-admission claim consumers beyond dispatch.
- `v2/docs/v1-behaviors.md` — canonical state derivation and durable cross-process stage exclusion.
