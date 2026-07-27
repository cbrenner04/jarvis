---
name: pipeline-durable-stage-state-and-daemon-execution
---

# Pipelines: durable stage state, daemon-owned execution

Slice 2 of [per-project pipelines](../per-project-pipelines-brief.md). Prereq:
`pipeline-definition-schema-and-validation`.

## Problem

A validated pipeline definition is inert until something runs it. Chaining attached CLI processes
would re-create every failure mode the daemon exists to avoid: an operator terminal owning
multi-hour work, no durable record of which stage was reached, nothing to resume.

## Decisions

- The daemon owns pipeline execution end to end. Rules out CLI-side chaining of `jarvis run
  workflow` invocations.
- Each stage records a stable stage ID, the workflow invocation ID it dispatched, status,
  start/end timestamps, produced artifact, and failure detail. Rules out inferring stage state from
  the workflow run rows alone — a stage that never dispatched has no run row.
- Stage state is durable in the existing state store, surviving daemon restart. Rules out in-memory
  pipeline state.
- A stage failure settles the pipeline at that stage with the failure recorded; later stages never
  dispatch. Rules out best-effort continuation.
- Daemon restart reconciliation treats a live pipeline the same as other non-terminal work: the
  pipeline row settles honestly rather than being silently dropped.

## Acceptance criteria

- [ ] Dispatching a pipeline creates a durable pipeline row plus one row per stage with the fields
      above; a test reads them back after a simulated process restart.
- [ ] Stages execute in definition order; a test asserts stage N+1 does not dispatch until stage N
      records terminal success.
- [ ] A failed stage records its failure detail and blocks later dispatch; inverting the guard turns
      the test RED.
- [ ] The dispatched workflow invocation ID on a stage row resolves to the real workflow run row.
- [ ] Execution runs on the daemon; a test asserts the CLI process is not required to remain
      attached for stage progression.
- [ ] Daemon restart with a non-terminal pipeline settles or resumes it deterministically and the
      pipeline row is never left non-terminal with no owner.

## Documentation updates

- `v2/docs/daemon-host.md` — pipeline execution ownership, stage row contract, restart behavior.
- `v2/docs/state-store.md` — pipeline and stage tables.
