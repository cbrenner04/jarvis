---
name: split-workflow-runner-test-suite
---

# Split The Workflow-Runner Test Suite

## Prerequisites

- Unsplit rationale: The execution-loop test suite and its per-file scheduling policy form one health contract; separate intents could not independently restore the supported budget while preserving and timing the complete inventory.

## Primary implementation surface

Execution-loop test health.

## Problem

- The workflow-runner suite sits at the supported per-file health threshold even without co-runners, so small additions deterministically red-gate the suite.
- A temporary budget increase masks the oversized file and prevents the health threshold from enforcing the intended split.

## Behavior

- Co-located workflow-runner test files group tests by behavior and each complete in at most 150 seconds, leaving at least 30 seconds below the 180-second health budget.
- Resume-path coverage completes in at most 120 seconds, leaving at least 60 seconds for future resume regressions.
- The supported per-file health budget returns to 180 seconds after every resulting file clears its required margin.

## Decisions

- Partition by execution concern and measured runtime; every resulting file must leave at least 30 seconds below the threshold and the resume-path file at least 60 seconds; rules out retaining the monolith or making a mechanical partition that leaves one file near the threshold.
- Preserve every test title, assertion, mutation directive, and keystone directive while matching the merge-base test inventory; rules out reducing or renaming coverage to improve runtime.
- Give resume-path tests a dedicated file or recovery-focused file that completes in at most 120 seconds; rules out placing new resume coverage in another near-budget suite.
- Extract shared test support only when it avoids substantial duplication and keep test globals in test files; rules out copied helper drift or a support module with invalid test-global ownership.
- Classify each resulting file for load-sensitive isolation from measured evidence under the documented lane rule; rules out blindly isolating every fragment or pooling a fragment with recorded load failures.
- Restore `SUPPORTED_HEALTHY_FILE_BUDGET_MS` and its parity pin to `180_000` and remove the stopgap text only after every split file completes in at most 150 seconds and the resume-path file in at most 120 seconds; rules out retaining the temporary ceiling or lowering it before the durable fix exists.

## Required verification

- Compare merge-base and branch test inventories and prove equal counts and unchanged titles, assertions, mutation directives, and keystone directives.
- Measure and report each resulting file's wall clock through the production runner policy at the restored threshold, including the 30-second minimum margin and the resume-path file's 60-second minimum margin.
- `bun run typecheck` and the full aggregate test command pass because root test tooling changes.

## Documentation updates

- `v2/docs/test-writing.md` — replace the monolith-specific audit state with the resulting workflow-runner files, their evidence-based isolation policy, and the rule to split any file approaching the per-file health budget.
- `v2/docs/v1-behaviors.md` — record the restored 180-second scheduler budget and evidence-based isolation behavior.
