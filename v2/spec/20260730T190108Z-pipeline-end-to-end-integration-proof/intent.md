---
name: pipeline-end-to-end-integration-proof
---

# Prove one pipeline end to end through the daemon

## Surface

Splitting does not apply: the change has one integration-test harness surface; its operator docs describe the same composed behavior without changing another module.

## Problem

Slice-level tests can stay green while pipeline definition, daemon progression, approval, resume, and terminal action no longer compose.

## Decisions

- One `test:integration:v2` case drives a real multi-stage pipeline through the daemon with agent invocation faked only at its boundary — rules out shallow per-stage integration cases.
- The case reads durable pipeline stage state after every boundary — rules out final-outcome-only proof that misses skipped stages.
- The case fails one workflow stage, resumes at that stage, and proves completed stages were not dispatched again — rules out happy-path-only coverage and restart-from-zero.
- The fixture is `full-review` (`intent → approve-intent → plan → approve-plan → implement`) with `ready` as its terminal action; `plan` fails once, then succeeds on resume — rules out an undefined composed path.
- Its durable status sequence is `pending×5` at admission; `succeeded, awaiting, pending, pending, pending` after intent; `succeeded, approved, running, pending, pending` when plan dispatches; `succeeded, approved, failed, skipped, skipped` on failure; `succeeded, approved, running, pending, pending` on resume; `succeeded, approved, succeeded, awaiting, pending` after resumed plan; `succeeded, approved, succeeded, approved, running` when implement dispatches; and `succeeded×5` after the ready action — rules out unpinned stage progression.
- `v2/docs/first-workflow-walkthrough.md` owns the pipeline walkthrough and `v2/docs/operator-runbook.md` links it — rules out duplicating operator steps in architecture docs.
- The integration proof is `v2/src/daemon/pipeline-end-to-end.sandbox-unrunnable.test.ts`, with agent invocation faked only at its boundary — rules out a fixture that bypasses daemon dispatch.

## Acceptance criteria

- [ ] `v2/src/daemon/pipeline-end-to-end.sandbox-unrunnable.test.ts` adds a `full-review` case that fails against the baseline, drives definition resolution through daemon dispatch, fails `plan` once, resumes it, approves both gates, and reaches the configured `ready` action with agent invocation faked only at the boundary.
- [ ] The case observes the pinned durable status sequence at every boundary, including reset of skipped later stages on resume, and proves the successful `intent` stage retains its invocation ID while resumed `plan` receives a new one.
- [ ] The named case turns RED if `intent`, `plan`, or `implement` is not dispatched, or if resume redispatches the completed `intent` stage.
- [ ] `bun run test:integration:v2` exits zero.
- [ ] `v2/docs/first-workflow-walkthrough.md` walks an operator through a configured pipeline.
- [ ] `v2/docs/operator-runbook.md` marks pipelines usable and links that walkthrough.

Name exactly one file per acceptance-criteria bullet; a bullet naming two files is rejected as
multi-surface when the spec tree is normalized.

## Documentation updates

- `v2/docs/first-workflow-walkthrough.md` — configured pipeline walkthrough.
- `v2/docs/operator-runbook.md` — pipeline usability and walkthrough link.

## Prerequisites

- Source-owned pipeline definitions and per-project selection resolve and validate workflow stages before admission.
- Daemon-owned pipeline execution durably records ordered stage identity, invocation linkage, lifecycle, artifacts, and failures.
- Approval decisions are durable, and resume re-enters a failed or awaiting-approval stage without redispatching completed stages.
- Pipeline CLI start, list, wait, and detach expose admission, stage state, approval boundaries, and terminal settlement.
- Configured draft, ready, and merge terminal actions validate before admission, preserve ready-gate enforcement, and settle failures durably.
