# Partition the workflow-runner test inventory

## Problem

- `v2/src/execution/workflow-runner.test.ts` combines unrelated execution concerns in one near-budget process, so small additions deterministically exceed the intended 180-second file-health threshold.

## Decisions

- Partition by execution concern, then balance by measured wall clock; rules out a line-count-only split that leaves one process near the threshold.
- Put resume-path coverage in a dedicated resume or recovery file capped at 120 seconds; rules out sharing its reserved headroom with unrelated coverage.
- Preserve merge-base test titles, assertions, `// @mutate` directives, and keystone directives byte-for-byte; rules out earning headroom by weakening, deleting, or renaming coverage.
- Extract shared support only when it avoids substantial duplication, without importing `bun:test` globals from support modules; rules out copied fixture drift and invalid test-global ownership.
- Keep relocated helper guards semantically unchanged; rules out hiding behavior changes inside a test-only partition.

## Tasks

- Split the monolith into co-located `workflow-runner-*.test.ts` files grouped by execution concern, including a dedicated resume or recovery file.
- Retain test globals in test files and move reusable setup to a sibling support module only where duplication would otherwise be substantial.
- Compare the merge-base monolith with the complete branch-side workflow-runner inventory for case counts, titles, assertion expressions, mutation directives, and keystone directives.
- Measure each resulting file alone and rebalance until every file completes within 150 seconds and the resume-path file within 120 seconds.

## Acceptance criteria

- [x] The co-located workflow-runner test files group cases by execution concern, and resume-path cases live in a dedicated resume or recovery file.
- [x] A merge-base-to-branch inventory comparison reports equal case counts and unchanged test titles, assertion expressions, `// @mutate` directives, and keystone directives across `v2/src/execution/workflow-runner.test.ts` and every resulting `workflow-runner-*.test.ts` file.
- [x] An isolated wall-clock measurement reports at most 150 seconds for every resulting file and at most 120 seconds for the resume-path file.
- [x] Relocated helper guards are unchanged; if implementation requires any added or modified guard, an in-body `// @mutate` checkpoint in its owning `workflow-runner-*.test.ts` test turns that test red when the guard is inverted.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass with the split inventory.

## Documentation updates

None — this subspec only partitions test code; the measured scheduling contract and durable audit are updated with the policy restoration in [01](./01-restore-per-file-health-policy.md).

## Blocker

`bun run test:v2` repeatedly times out in unrelated subprocess-heavy files under suite load, and `bun run test:integration:v2` repeatedly fails because `write-loop-ready-gate-reap.sandbox-unrunnable.test.ts` never observes its trap marker, including serial unsandboxed runs. The split files, inventory audit, isolated timing, helper-body audit, and `bun run typecheck` pass.
