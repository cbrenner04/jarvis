---
name: partition-v1-run-command-tests-remaining
---

# Partition v1 run-command tests (remaining: loop/timeout/blocker + review)

## Problem

`v1/test/run.test.ts` was partitioned into `completion-gate.test.ts`,
`run-command-routing.test.ts`, `run-command-linked-subspec-and-pr.test.ts`, and
`run-command-failure-and-preflight.test.ts` (subspecs 00-03 of the original
`partition-v1-run-command-tests` spec, landed 2026-07-19). Two of the original
6 subspecs remain: loop/timeout/blocker coverage and review-phase coverage
still live in `run.test.ts`.

Both prior implement attempts self-blocked (`contract_miss`) immediately after
finishing exactly subspecs 00-03 in one iteration, without continuing to a
second iteration. Scope this seed to only the remaining two partitions so a
single implement run can complete it in one shot.

## Decisions

- Group loop-only mode, deterministic timeout bookkeeping, and blocker
  adjudication as one cohesive iteration-control test file.
- Group completion review and `--resume-review` coverage as one cohesive
  review test file.
- Preserve assertions and production code unchanged; behavior-preserving
  relocation only.
- Keep process-backed timeout coverage outside the loop/timeout/blocker
  partition; `v1/test/run.sandbox-unrunnable.test.ts` stays green.
- Leave agent stream-settlement regressions in `v1/test/run.test.ts`; only
  review-phase and `--resume-review` cases move to the review partition.

## Out of scope

- Changing run-command production behavior.
- Further partitioning `v1/test/run.test.ts` beyond these two files.

## Documentation updates

None — test-only behavior-preserving partition.
