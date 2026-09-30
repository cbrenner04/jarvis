---
name: shrink-post-mutation-reverify
---

# Shrink re-runs diff-derived mutation verification before publication

## Problem

The post-implement `shrink` step may delete or reshape co-located killing tests with no mutation re-check; publication then fails terminal `surviving_mutation_failed` with no in-shrink recovery.

## Decisions

- After a successful shrink iteration, run the same diff-derived mutation verifier used at implement complete (same run base); on `surviving-mutation`, reprompt or revert like the in-loop implement path — not prompt wording alone.
- `implement.prompt.shrink` rules forbid deleting tests that cover changed guards.

## Acceptance criteria

- [ ] A write-loop or workflow-runner fixture where shrink deletes the co-located killing test for a changed guard yields `surviving_mutation_reprompt` or equivalent revert before publication; fails against the pre-fix shrink-complete path.

## Documentation updates

- `v2/docs/write-behavior.md` — shrink mutation re-verification after post-completion shrink.

## Prerequisites
