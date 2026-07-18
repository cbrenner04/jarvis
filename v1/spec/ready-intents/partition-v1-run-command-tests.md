---
name: partition-v1-run-command-tests
---

# V1 run-command tests execute in bounded cohesive files

## Problem

The v1 run-command suite is concentrated in one slow file. Raising the aggregate timeout restored the gate but left one monolith able to consume most of the per-file budget.

## Decisions

- Partition tests by cohesive run behavior into independently runnable files; rules out treating a larger timeout as the structural fix.
- Preserve assertions while extracting only the shared fixtures needed by each partition; rules out combining a coverage rewrite with the move.
- Keep each partition reviewable and independently green; rules out a single opaque mechanical relocation.
- The incident per-file allowance is 180 seconds; no partition may depend on unrelated run behaviors sharing that allowance.

## Out of scope

- Changing run-command production behavior.
- Choosing the aggregate runner's permanent timeout mechanism.

## Acceptance criteria

- Each resulting run-command test file passes independently and in `test:v1`.
- `v1/test/run.test.ts` and `v1/test/run.sandbox-unrunnable.test.ts` stay green after the partition.
- No resulting file depends on the 180-second allowance solely because unrelated run behaviors share one process.

## Documentation updates

None — test-only behavior-preserving partition.

## Prerequisites
