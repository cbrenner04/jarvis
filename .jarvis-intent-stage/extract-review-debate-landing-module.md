---
name: extract-review-debate-landing-module
---

# Extract review-debate landing into a sibling module

## Primary implementation surface

Execution loop — review-debate step dispatch and post-debate landing in `v2/src/execution/`

## Problem

Review-debate step execution, post-debate landing orchestration, and actuator-only retry live inline in `workflow-runner.ts`, inflating the file targeted for resume-machine extraction and mixing dispatch with landing settlement.

## Behavior

Review-debate landing orchestration (`runReviewDebateStep`, post-debate landing, actuator-only retry, and their private helpers) moves to a named sibling module; `workflow-runner.ts` keeps the step loop and imports the landing entrypoint. Landing and settlement semantics stay unchanged.

## Decision ledger

- Move only review-debate landing orchestration; rules out extracting shared review-landing promotion (`landReviewedPublicationOutput`) or resume machines in the same review.
- Co-locate debate landing tests with the new module; rules out leaving them in `workflow-runner-debate.test.ts` after the production move.
- Behavior-preserving extraction only; rules out settlement-semantics redesign ([[pipeline-settlement-derives-from-run-rows]] owns that).

## Acceptance criteria

- [ ] `workflow-runner.ts` no longer contains review-debate landing orchestration; a structural assertion fails if those symbols remain inline.
- [ ] `workflow-runner-debate.test.ts` landing and post-debate settlement tests stay green when re-pointed at the extracted module.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — module map entry for review-debate landing ownership.

## Prerequisites
