---
name: bind-fan-out-plan-dispatch-by-branch-key
---

# Bind Fan-out Plan Dispatch by Branch Key

## Problem

Fan-out execution and recovery consume plan resolutions by array position, so reordered or short results can bind a lane to a sibling input without a guarded refusal.

## Primary implementation surface

- Pipeline execution loop in `v2/src/daemon/pipeline-execution.ts` and its plan-recovery consumer.

Unsplit rationale: Dispatch and recovery consume the same fan-out plan resolution at one execution surface.

## Prerequisites

- Fan-out plan resolution selects only the downstream input whose derived branch key equals the active lane, treats consumed siblings as satisfied for legitimate whole-list verification, and returns lane-and-input-named match refusals without intent-stage re-drive guidance.

## Decisions

- Bind every fan-out plan resolution consumer to downstream input by derived `branchKey` equality; rules out `results[branchIndex]` joins in execution and recovery.
- Refuse a mismatched or short binding before dispatch with the affected lane and downstream input named; rules out dispatching sibling steps or silently skipping the target lane.
- An approval continuation dispatches only the approved lane's matched plan steps; rules out re-resolving or dispatching sibling lanes.

## Acceptance criteria

- [ ] A `pipeline-execution.test.ts` regression plans one lane, consumes its ready-intent into the landed spec tree, approves the second lane, and proves the second plan run dispatches; it fails against the pre-fix resolver with the first lane's path.
- [ ] Execution tests reorder fan-out resolution results and prove each lane dispatches the result with the matching derived branch key rather than the same array position.
- [ ] Execution tests supply a mismatched or short result set and prove dispatch refuses with the affected lane and downstream input named without dispatching sibling steps.
- [ ] Plan-recovery tests prove a non-first lane selects its branch-key-matched result and refuses a missing match without positional fallback.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- Update `v2/docs/pipeline-execution.md` with branch-key result binding across dispatch and recovery.
- Update `v2/docs/operator-runbook.md` to retire the workaround that serial approval required hand-driving later fan-out lanes for this failure shape.
- Update `v2/docs/v1-behaviors.md` with branch-key-bound fan-out plan dispatch.
