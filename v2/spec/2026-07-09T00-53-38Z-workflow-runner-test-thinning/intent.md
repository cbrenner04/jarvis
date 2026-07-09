---
name: workflow-runner-test-thinning
---

# Thin workflow-runner.test.ts subsumed and duplicated coverage

`workflow-runner.test.ts` has a multi-step mega-test that subsumes narrower
tests, a workflow-level quota-fallback re-proof already owned by the resolver
and step-runner tests, a role-validation trio that's really one aggregated
error, and ~25 repeated `openStateStore(":memory:")` try/finally blocks.

## Decisions

- Drop "runs two-step workflow to completion" and the subsumed parts of "runs
  single step" — covered by the multi-step mega-test.
- Drop the workflow-level quota-fallback rung-ordering re-proof — owned by the
  resolver + step-runner tests.
- Collapse the role-validation trio (three assertions on one aggregated error)
  into one table.
- Extract the repeated `openStateStore(":memory:")` try/finally blocks into a
  shared fixture.

## Out of scope

- Src changes.
- Dropping coverage for quota-fallback rung ordering at the resolver/step-runner
  layer.

## Verification

Test-count diff vs baseline in the PR body; every dropped test named with its
surviving owner.

## Prerequisites
