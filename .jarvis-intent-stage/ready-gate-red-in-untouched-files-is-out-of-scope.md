---
name: ready-gate-red-in-untouched-files-is-out-of-scope
---

# Ready gate red only in files the run did not touch is an out-of-scope failure

## Problem

Load flake often reds tests outside the run's diff. The harness retries repair against the whole gate
output, so the agent "fixes" unrelated failures.

## Decisions

- When the gate output can be attributed to failing paths, and every failing path lies outside the
  run's diff plus spec tree, classify the outcome as out-of-scope gate failure — distinct from
  `ready_gate_failed` caused by the run's own changes. Rules out entering bounded repair for pure
  flake.
- Operator-visible detail names that the failures are outside the run's touched paths. Rules out
  silent repair against unrelated red tests.

## Acceptance criteria

- [ ] A ready gate whose failures are all in paths outside the run diff plus spec tree settles as an
      out-of-scope gate failure with a named reason; a test fails against pre-fix behavior that enters
      repair instead.
- [ ] A gate failure that includes at least one failing path inside the run's touched set still
      follows today's `ready_gate_failed` repair path.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — red gate only in untouched files is out-of-scope;
  review every repair commit's file list before merging.

## Prerequisites

