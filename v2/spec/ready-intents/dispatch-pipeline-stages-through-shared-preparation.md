---
name: dispatch-pipeline-stages-through-shared-preparation
---

# Dispatch pipeline stages through shared workflow preparation

## Prerequisites

- CLI workflow starts use one shared preparation API for realizability, preset building, machine-config stamping, and stale-reset preflight.
- Pipeline admission persists a schema-checked context with `configPath`, and fresh and continued execution load that durable snapshot without defaults.

## Primary implementation surface

- Daemon pipeline stage resolution and dispatch in `v2/src/daemon/`

## Problem

- Pipeline stage resolution rebuilds CLI preparation with a posture table, fixed review passes, direct preset calls, post-build stamping, and intent-only synthetic stale reset.
- The duplicate path overrides configured implement review policy and excludes plan, implement, and fan-out stages from the CLI preflight contract.

## Behavior

- Single-stage and fan-out pipeline dispatch adapt stage posture, artifacts, and persisted context into the shared workflow preparation API.
- CLI and pipeline adapters produce byte-identical steps for the same workflow, review posture, and project config.
- Implement stages resolve review passes and behavior from the canonical project-config source; posture selects review kind without hardcoding a pass count.
- Every pipeline workflow stage runs the shared stale-reset gate with normalized pipeline policy rather than synthetic CLI argv.

## Decision ledger

- Delete daemon-local posture-to-preset assembly after routing every stage shape through shared preparation; rules out parity-by-test over two production implementations.
- Let canonical implement config resolution supply review passes and behavior; rules out `FIXED_REVIEW_PASSES` or a daemon-local config fallback overriding project policy.
- Apply shared preparation before each fan-out dispatch as well as the single-stage path; rules out branch dispatch retaining raw preset output.
- Represent pipeline stale-reset policy as normalized preparation input; rules out synthetic parsed argv and intent-only gating.

## Acceptance criteria

- [ ] A cross-path test drives CLI and daemon adapters through shared preparation and asserts byte-identical steps for representative `intent`, `plan`, and `implement` workflow/posture/config triples; it fails against the pre-fix daemon assembly.
- [ ] A pipeline implement regression configures review passes above one and a non-default review behavior, then asserts the dispatched review step carries both configured values; it fails against `FIXED_REVIEW_PASSES = 1`.
- [ ] Plan, implement, single-stage, and fan-out pipeline regressions prove the shared stale-reset gate runs before dispatch and a refusal records stage failure without starting a workflow; they fail against the pre-fix intent-only synthetic gate.
- [ ] A structural test leaves one production authority for realizable workflow/review pairs and one prepared-step assembly.
- [ ] `v2/src/daemon/pipeline-stage-resolve.test.ts` — `fan-out implement resolution binds active branchKey plan artifact when siblings populate out of order`, `v2/src/daemon/pipeline-execution.test.ts` — `approving both fan-out branches dispatches each successor on its own branchKey`, and `v2/src/commands/workflow.test.ts` — `run workflow implement sends start and wait IPC requests, blocks on completion, and prints run ID and wait JSON` stay green.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — pipeline stages and CLI workflow starts share preparation, config resolution, stamping, and stale-reset semantics.
- `v2/docs/v2-architecture.md` — daemon pipeline dispatch consumes the shared workflow-start front door.
- `v2/docs/workflow-runner.md` — pipeline posture and project review-config ownership.
- `v2/docs/v1-behaviors.md` — replace daemon-local pipeline assembly and intent-only stale-reset behavior.
