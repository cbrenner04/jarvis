---
name: pipeline-dispatch-shares-cli-front-door
---

# Pipeline dispatch assembles workflow starts through the same front door as the CLI

## Problem

The in-flight `pipeline-dispatch-config-parity` spec fixes step-config stamping (D1/D2), but the daemon pipeline path still re-implements the rest of the CLI's workflow-start assembly by hand, and each copy is a drift site (2026-08-29 review, seams D3–D8):

- Review posture: `WORKFLOW_POSTURE_PRESETS` + hardcoded `FIXED_REVIEW_PASSES = 1` (`pipeline-stage-resolve.ts:59-64`) vs the CLI's `--review-passes`/`--review-behavior` parsing and `resolveImplementReviewConfig` (`implement-workflow-steps.ts:190-210`) — pipelines silently override a project's configured implement review passes.
- Realizable (workflow, review) pairs live in both the CLI arg parsers and `pipeline-definition.ts:80-130`, held together only by `pipeline-posture-cli-alignment.test.ts`.
- Stale-reset preflight: CLI gates intent|plan|implement on real parsed argv (`workflow.ts:364`); pipeline gates intent only, on synthetic input (`pipeline-execution.ts:1669-1716`).
- Workflow-start admission (registry claim, memory headroom, `activeRuns`) is re-implemented by hand for recovery at `daemon.ts:2166-2183`.
- Fresh starts read the RPC-supplied `PipelineContext` (`daemon.ts:2077`) while continues read the persisted row (`pipeline-execution.ts:200`) — divergence surfaced live 2026-08-29 when the parity implement had to invent a missing-`configPath` fallback for persisted rows.

## Decisions

- One shared prepared-steps assembly (posture → preset → steps → stamp → stale-reset gate) that both CLI `run workflow` and daemon stage dispatch call; the CLI becomes a thin argv adapter over it. Rules out a third copy and rules out parity-by-test as the only guard.
- Pipeline stages resolve implement review passes/behavior from the same project-config source as the CLI; the posture table maps posture → review *kind* only. Rules out `FIXED_REVIEW_PASSES` silently overriding project config.
- Stage recovery admission calls the same admission path as `handleWorkflowStart` instead of a hand-copy. Rules out recovery drifting from live-start admission rules.
- Persisted `PipelineContext` is either complete at admission (schema-checked) or completed at continue-time from one documented source; a missing required field fails the stage with a named loader error, never a silent default. Rules out the fresh-vs-persisted split reintroducing unstamped dispatch.

## Acceptance criteria

- [ ] CLI `run workflow` and daemon stage dispatch produce byte-identical step arrays for the same (workflow, posture, config) triple, pinned by a test that drives both paths through the shared assembly.
- [ ] A pipeline implement stage carries the project's configured review passes/behavior, pinned by a test that fails against the hardcoded single pass.
- [ ] Stage recovery admission and `handleWorkflowStart` admission share one implementation, pinned structurally (single call target) plus a behavior test.
- [ ] A persisted context missing a required field fails the stage with a named error rather than dispatching with defaults, pinned by a test.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — pipeline dispatch and CLI admission share one assembly; remove remaining dual-path prose.
- `v2/docs/v2-architecture.md` — the shared workflow-start front door.
