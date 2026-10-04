---
name: daemon-start-list-test-thinning
---

# Extract list-snapshot mapping and drop subset coverage in daemon-start-list.test.ts

`daemon-start-list.test.ts` mixes a pure run/step-status-to-terminalOutcome
mapping with composed list behavior, and has a kill-abort test that's a strict
subset of another. Operator-error columns should keep only one wiring check
per surface, leaving the mapping matrix owned by `run-operator-error.test.ts`.

## Decisions

- Extract the pure list-snapshot mapping (run/step status → terminalOutcome)
  into unit tests over the mapping function, plus one composed list test.
- Export the mapping function from src if it isn't already directly
  reachable.
- Drop "kill aborts the abort signal that bindings can observe" — strict
  subset of "kill aborts an active run and records killed status".
- Keep one operator-error wiring check per surface; leave the mapping matrix
  owned by `run-operator-error.test.ts`, which stays untouched.

## Out of scope

- Src changes beyond exporting the list-snapshot mapping function.
- Changes to `run-operator-error.test.ts`.

## Verification

Test-count diff vs baseline in the PR body; every dropped test named with its
surviving owner.

## Prerequisites

- Daemon `start` params are settled (post daemon-binding-resolution-unification).
