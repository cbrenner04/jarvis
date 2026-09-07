---
name: resolve-fan-out-plan-input-by-branch-key
---

# Resolve Fan-out Plan Input by Branch Key

## Problem

Branch-scoped plan resolution verifies every sibling ready-intent, so one lane already consumed into a landed spec tree blocks an untouched approved lane before dispatch.

## Primary implementation surface

- Daemon stage resolution in `v2/src/daemon/pipeline-stage-resolve.ts`.

## Prerequisites

## Decisions

- Resolve a fan-out plan lane from the sole downstream input whose `branchKeyFromDownstreamInput(path)` equals the active `branchKey`; rules out whole-list verification for branch-scoped resolution.
- Refuse an unmatched lane-to-input request with the lane and available downstream inputs named; rules out positional fallback or silent selection.
- Treat a downstream input consumed into an already-landed spec tree as satisfied when an unscoped caller legitimately verifies the whole list; rules out completed sibling work becoming a missing-input failure.
- Omit intent-stage re-drive guidance when the prior intent stage succeeded; rules out directing the operator to repeat unrelated work.

## Acceptance criteria

- [ ] A `pipeline-stage-resolve.test.ts` regression requests the second fan-out lane while a sibling input is unresolvable and proves only the requested lane is verified and built; it fails against the pre-fix whole-list resolver.
- [ ] Resolver tests prove lane selection uses derived branch-key equality and an unmatched request refuses with the lane and available downstream inputs named.
- [ ] An unscoped whole-list resolver test represents a sibling ready-intent consumed into its landed spec tree and proves that sibling is satisfied rather than missing.
- [ ] Resolver refusal tests prove a failed lane is named and successful prior intent work is not answered with `re-drive the prior stage standalone`.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- Update `v2/docs/pipeline-execution.md` with branch-scoped downstream-input selection, consumed-input satisfaction, and refusal semantics.
- Update `v2/docs/v1-behaviors.md` with the changed v2 plan-resolution behavior.
