---
name: runtime-smoke-records-discovery-outcomes
---

# Runtime smoke records discovery outcomes

Completion currently discards a successful verifier result, so operators cannot distinguish an executed clean smoke from a vacuous `not-runnable` pass. Persist the discovery outcome in the run log.

## Decisions

- Record `not-runnable` as a distinct runtime-smoke outcome with inspected paths and discovery reason; rules out a generic passing gate record.
- Record executed clean smoke distinctly from discovery absence; rules out treating both as equivalent evidence.
- Require a reason whenever production changes under `v2/src/**` or `shared/**` yield `not-runnable`; rules out silent smoke omission on harness code.

## Acceptance criteria

- A `not-runnable` result for a `v2/src/**` or `shared/**` production diff writes its inspected paths and reason to the durable run log.
- Run-log consumers can distinguish `not-runnable` from an executed `observed-clean` smoke.
- `workflow-runner.test.ts` verifies that completion records a successful `not-runnable` verifier result; it fails against the current result-discarding integration and passes after the change.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — how to inspect smoke evidence and what `not-runnable` certifies.
- `v2/docs/workflow-runner.md` — durable runtime-smoke outcome fields.
- `v2/docs/v1-behaviors.md` — record the changed v2 completion evidence.

## Prerequisites

- Runtime smoke returns `not-runnable` with inspected paths and a discovery reason.
