---
name: ready-gate-repair-cannot-extend-load-sensitive-files
---

# Ready-gate repair cannot add `LOAD_SENSITIVE_FILES` entries

## Problem

Repair on PR #2243 added three files to `LOAD_SENSITIVE_FILES` — an operator-level suite execution
policy change to green a red gate.

## Decisions

- A ready-gate repair commit that increases the `LOAD_SENSITIVE_FILES` set fails the repair — rules
  out repair-time relaxation of load-sensitivity classification.
- Edits to the defining module that do not grow that set remain subject only to the ordinary run-diff
  path fence — rules out banning all edits when the run legitimately touched the module for other
  reasons.

## Acceptance criteria

- [ ] A repair staging an addition to `LOAD_SENSITIVE_FILES` fails before publish; a test fails
      against pre-fix behavior.
- [ ] Inverting the guard turns that test red.

## Documentation updates

- `v2/docs/test-writing.md` — load-sensitivity list changes are operator decisions, not repair-time.

## Prerequisites

- Ready-gate repair completion validates staged paths against the run diff plus spec tree before commit.
