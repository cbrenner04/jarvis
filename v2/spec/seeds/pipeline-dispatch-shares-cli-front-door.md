---
name: pipeline-dispatch-shares-cli-front-door
---

# Pipeline dispatch shares the CLI workflow-start front door

## Problem

Pipeline stage resolution and dispatch duplicate CLI workflow-start preparation: a local posture-to-preset table, fixed review passes, direct preset-builder calls, post-build machine-config stamping, and intent-only synthetic stale reset. The duplicate path overrides configured implement review policy and excludes plan, implement, and fan-out stages from the CLI preflight contract.

## Pending implementation chain

Land in dependency order:

1. [`share-workflow-start-preparation`](../ready-intents/share-workflow-start-preparation.md) — shared preparation API; CLI first consumer.
2. [`dispatch-pipeline-stages-through-shared-preparation`](../ready-intents/dispatch-pipeline-stages-through-shared-preparation.md) — route daemon dispatch through that API.
3. [`admit-pipeline-recovery-through-workflow-start`](../ready-intents/admit-pipeline-recovery-through-workflow-start.md) — recovery admission through the same front door.

## Decision ledger

- Retire daemon-local posture-to-preset assembly after every stage shape routes through shared preparation; rules out parity-by-test over two production implementations.
- Let canonical implement config resolution supply review passes and behavior; rules out `FIXED_REVIEW_PASSES` or a daemon-local config fallback overriding project policy.
- Apply shared preparation before each fan-out dispatch as well as the single-stage path; rules out branch dispatch retaining raw preset output.

## Acceptance criteria

- [ ] A cross-path test drives CLI and daemon adapters through shared preparation and asserts byte-identical steps for representative `intent`, `plan`, and `implement` workflow/posture/config triples; it fails against the pre-fix daemon assembly.
- [ ] A pipeline implement regression configures review passes above one and a non-default review behavior, then asserts the dispatched review step carries both configured values; it fails against `FIXED_REVIEW_PASSES = 1`.
- [ ] Plan, implement, single-stage, and fan-out pipeline regressions prove the shared stale-reset gate runs before dispatch and a refusal records stage failure without starting a workflow; they fail against the pre-fix intent-only synthetic gate.
- [ ] A structural test leaves one production authority for realizable workflow/review pairs and one prepared-step assembly.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/pipeline-execution.md` — retire merge-day dispatch duplication once landed.
- `v2/docs/workflow-runner.md` — shared preparation ownership.
- `v2/docs/daemon-host.md` — dispatch boundary after front-door lands.
