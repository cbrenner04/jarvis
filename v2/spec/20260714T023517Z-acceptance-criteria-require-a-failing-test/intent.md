---
name: acceptance-criteria-require-a-failing-test
---

# Planner drafts a failing-test acceptance criterion for every runtime-behavior subspec

Plan mode currently drafts subspecs whose criteria are satisfiable by reading the code, so runs
land new runtime behavior with zero tests and a green gate.

## Decisions

- Every subspec that changes runtime behavior carries an acceptance criterion naming a test that
  fails against the pre-fix code and passes after the change.
- "Existing tests stay green" does not count as that criterion — it is satisfied by changing nothing.
- Docs-only and spec-only subspecs are exempt.
- The requirement lives in the plan prompt / spec guidance so it applies to every drafted spec,
  not to the implementing agent's judgment.

## Documentation updates

- `v1/docs/spec-guidance.md` § Acceptance criteria — state the failing-test requirement; use the
  `blocked-run-retains-worktree-and-branch` criterion as the model.

## Out of scope

- Mechanical coverage enforcement (diff-coverage gate).

## Prerequisites
