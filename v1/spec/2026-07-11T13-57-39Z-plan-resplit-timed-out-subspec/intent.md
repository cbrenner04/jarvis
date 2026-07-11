---
name: plan-resplit-timed-out-subspec
---

# Plan re-splits timed-out subspecs

## Problem

Fresh runs that time out once on an oversized subspec force operators to rewrite the spec tree by hand.

## Decisions

- Plan provides an operator-directed recovery that replaces one timed-out subspec with smaller independently testable subspecs rather than requiring branch-and-PR spec surgery.
- Recovery preserves a valid index and subspec cross-references rather than leaving renumbering to the operator.
- Recovery is explicit rather than silently rewriting a merged spec from timeout history.
- Deferred to first consumer: recovery command syntax and timeout-history presentation — pin when the operator invokes recovery.

## Documentation updates

- Update `v1/docs/plan-mode.md` and `v2/docs/v1-behaviors.md` with timed-out-subspec recovery.
- Remove the manual subspec-split stopgap from `v1/docs/operator-runbook.md`.

## Out of scope

- Changing `iterationTimeoutMs`.

## Prerequisites

- Plan resume can reopen an existing spec tree.
