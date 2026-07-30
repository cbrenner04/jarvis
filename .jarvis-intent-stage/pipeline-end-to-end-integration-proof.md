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
- The resumed pipeline crosses approval and reaches its configured terminal action — rules out treating resume or approval as the terminal proof.
- `v2/docs/first-workflow-walkthrough.md` owns the pipeline walkthrough and `v2/docs/operator-runbook.md` links it — rules out duplicating operator steps in architecture docs.
- Deferred to first consumer: exact stage-status sequence, fixture pipeline, and terminal action — pin from the merged prerequisite contracts when the integration test is planned.

## Acceptance criteria

- [ ] One `*.sandbox-unrunnable.test.ts` case drives definition resolution, daemon dispatch, ordered workflow and approval stages, failure, stage-scoped resume, and the configured terminal action with agent invocation faked at the boundary.
- [ ] The case asserts durable stage rows after each transition and proves completed stages retain their invocation IDs across resume.
- [ ] Removing any authored stage dispatch or allowing resume to redispatch a completed stage turns the case RED.
- [ ] `bun run test:integration:v2` exits zero.
- [ ] `v2/docs/first-workflow-walkthrough.md` walks an operator through a configured pipeline, and `v2/docs/operator-runbook.md` marks pipelines usable and links that walkthrough.

## Documentation updates

- `v2/docs/first-workflow-walkthrough.md` — configured pipeline walkthrough.
- `v2/docs/operator-runbook.md` — pipeline usability and walkthrough link.

## Prerequisites

- Source-owned pipeline definitions and per-project selection resolve and validate workflow stages before admission.
- Daemon-owned pipeline execution durably records ordered stage identity, invocation linkage, lifecycle, artifacts, and failures.
- Approval decisions are durable, and resume re-enters a failed or awaiting-approval stage without redispatching completed stages.
- Pipeline CLI start, list, wait, and detach expose admission, stage state, approval boundaries, and terminal settlement.
- Configured draft, ready, and merge terminal actions validate before admission, preserve ready-gate enforcement, and settle failures durably.
