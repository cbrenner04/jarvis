---
name: cli-test-thinning
---

# Thin cli.test.ts re-proofs of handler/pure-layer behavior

`cli.test.ts` re-proves wait semantics, list-row composition, and operator-error
column behavior already owned by the handler/pure layers. Drop the re-proofs,
table-drive the exit-code mapping, and remove tests that only assert a test
fixture's own mock behavior.

## Decisions

- Drop `cli.test.ts` re-proofs of wait semantics, list-row composition, and
  operator-error columns — owned by handler/pure layers.
- Table-drive the exit-code mapping singles using the existing `run wait maps
  %p to exit %i` `test.each` pattern.
- Drop the randomUUID-uniqueness test.
- Drop the simulated-bindings describe block — it asserts a test fixture's own
  mock behavior, not product behavior.

## Out of scope

- Src changes.
- Dropping coverage for wait semantics, list-row composition, or
  operator-error columns at their owning layer.

## Verification

Test-count diff vs baseline in the PR body; every dropped test named with its
surviving owner.

## Prerequisites
