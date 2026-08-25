---
name: split-workflow-runner-test-suite
---

# Split The Workflow-Runner Test Suite

## Prerequisites

Unsplit rationale: The execution-loop test suite and its per-file scheduling policy form one health contract; separate intents could not independently restore the supported budget while preserving and timing the complete inventory.

## Primary implementation surface

Execution-loop test health.

## Problem

- The workflow-runner suite sits at the supported per-file health threshold even without co-runners, so small additions deterministically red-gate the suite.
- A temporary budget increase masks the oversized file and prevents the health threshold from enforcing the intended split.

## Behavior

- Co-located workflow-runner test files group tests by behavior and each complete comfortably inside the supported per-file health budget.
- Resume-path coverage has dedicated headroom for future resume regressions.
- The supported per-file health budget returns to 180 seconds after every resulting file clears it with measured margin.

## Decisions

- Partition by execution concern and measured runtime; rules out retaining the monolith or making a mechanical partition that leaves one file near the threshold.
- Preserve every test title, assertion, mutation directive, and keystone directive while matching the merge-base test inventory; rules out reducing or renaming coverage to improve runtime.
- Give resume-path tests a dedicated file or recovery-focused file with measured headroom; rules out placing new resume coverage in another near-budget suite.
- Extract shared test support only when it avoids substantial duplication and keep test globals in test files; rules out copied helper drift or a support module with invalid test-global ownership.
- Classify each resulting file for load-sensitive isolation from measured evidence under the documented lane rule; rules out blindly isolating every fragment or pooling a fragment with recorded load failures.
- Restore `SUPPORTED_HEALTHY_FILE_BUDGET_MS` and its parity pin to `180_000` and remove the stopgap text only after the split files clear that threshold; rules out retaining the temporary ceiling or lowering it before the durable fix exists.

## Required verification

- Compare merge-base and branch test inventories and prove equal counts and unchanged titles, assertions, mutation directives, and keystone directives.
- Measure and report each resulting file's wall clock through the production runner policy at the restored threshold.
- `bun run typecheck` and the full aggregate test command pass because root test tooling changes.

## Documentation updates

- `v2/docs/test-writing.md` — replace the monolith-specific audit state with the resulting workflow-runner files, their evidence-based isolation policy, and the rule to split any file approaching the per-file health budget.
