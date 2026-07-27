---
name: ready-gate-repair-cannot-extend-load-sensitive-files
---

# Ready-gate repair cannot add `LOAD_SENSITIVE_FILES` entries

## Problem

Repair on PR #2243 added three files to `LOAD_SENSITIVE_FILES` — an operator-level suite execution
policy change to green a red gate.

## Decisions

- A ready-gate repair commit that increases the `LOAD_SENSITIVE_FILES` set (by any edit to its
  defining source) fails the repair. Rules out repair-time relaxation of load-sensitivity
  classification.
- Decreases or non-list edits to the same file follow the ordinary run-diff path fence only. Rules
  out banning all edits to the defining module when the run legitimately touched it for other reasons.

## Acceptance criteria

- [ ] A repair staging an addition to `LOAD_SENSITIVE_FILES` fails before publish; a test fails
      against pre-fix behavior.
- [ ] Inverting the guard turns that test red.

## Documentation updates

- `v2/docs/test-writing.md` — load-sensitivity list changes are operator decisions, not repair-time.

## Prerequisites

- Ready-gate repair completion validates staged paths before commit.
