# 02 - Review-owned ready-gate repair

## Problem

Ready-gate repair autofix reads `fixCommand` from the `WriteLoopInput` passed into `publishWithReadyRepair`. Review-owned finalization that still sources gate commands from the write sibling leaves `fixCommand` unstamped on repair entry, so configured project autofix never runs on the review gate path.

## Decision ledger

- Ready-gate repair on review-owned finalization consumes the same gate-owning-step `fixCommand` resolver introduced in [[00-fresh-dispatch-gate-commands]] for fresh dispatch and [[01-gate-only-continuation-invocation]] for continuation; rules out a separate repair-only command lookup.
- Absent `fixCommand` on the gate-owning step keeps built-in scoped autofix semantics unchanged; rules out changing default repair behavior while fixing propagation.

## Task checklist

- Ensure review-last and review-debate-last publication tails and their gate-only continuation counterparts thread resolved `fixCommand` into `publishWithReadyRepair`.
- Add a review-owned regression where the gate-owning step carries a distinct `fixCommand`, the ready gate fails once, and autofix observes the configured command.

## Acceptance criteria

- [x] `v2/src/execution/workflow-runner-publication.test.ts` proves a review-row `fixCommand` reaches the configured ready-gate repair autofix path; the test fails against the pre-fix write-sibling-only gate-command propagation reachable on main.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.

## Documentation updates

- Deferred to [[04-documentation]].
