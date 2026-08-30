---
name: persist-accepted-equivalent-mutation-events
---

# Persist accepted equivalent-mutation events

## Prerequisites

- The diff-derived verifier accepts only a source-line directive carrying its exact generated mutation string and a non-empty reason.
- Equivalent-mutation acceptance is scoped to the candidate's exact file, physical line, and mutation while every other candidate remains blocking.
- A passing verification result reports every accepted site's file, line, mutation, and reason.

## Primary implementation surface

- Durable run-log persistence

## Problem

- An accepted equivalent mutation can let completion proceed, but the durable run log has no record distinguishing that reviewed exemption from fully killed mutation coverage.

## Behavior

- Completion appends one durable `accepted_equivalent_mutation` event per verifier-reported acceptance, naming its file, line, mutation, and reason.
- `jarvis run log <run-id>` replays accepted-equivalent events through the existing structured-log path.
- Runs with no accepted equivalent mutation emit no accepted-equivalent event.

## Decision ledger

- Persist one event per accepted site with file, line, full mutation string, and reason; rules out an aggregate count that cannot be audited against the source diff.
- Emit only from verifier-reported acceptances; rules out the completion path rescanning source or trusting unvalidated comments.
- Reuse the structured run log and its normal replay path; rules out a separate allowlist, sidecar, or CLI-only message.

## Acceptance criteria

- [ ] A completion-path regression accepts an exact equivalent-mutation directive and asserts the durable log contains one `accepted_equivalent_mutation` event with its file, line, mutation, and reason; it fails against the prerequisite-only path, which completes without the event.
- [ ] A regression proves multiple accepted sites produce distinct events and a run without accepted sites produces none.
- [ ] The persisted event is visible through the same records replayed by `jarvis run log <run-id>` without a separate lookup path.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — accepted-equivalent event emission at completion verification.
- `v2/docs/operator-runbook.md` — use `jarvis run log` to audit accepted equivalent mutations against the PR diff.
- `v2/docs/v1-behaviors.md` — record durable audit events for the v2-only equivalent-mutation escape hatch.
