# 00 - Snapshot persistence

## Problem

`buildWorkflowSnapshot` (`v2/src/execution/workflow-runner.ts`) copies `fixCommand` and `readyCommand` only inside the `behavior === "write"` branch. Review and review-debate steps admitted with stamped overrides lose those values when the shared workflow snapshot is persisted, so durable review rows cannot retain dispatch-time gate configuration.

## Decision ledger

- Copy stamped `fixCommand` and `readyCommand` onto review and review-debate snapshot steps when present on the admitted step; rules out leaving gate commands write-only in the snapshot mapper.
- Omit both fields when the admitted step carried neither override; rules out materializing built-in defaults onto snapshot rows.
- Legacy snapshots without gate-command fields on any step remain valid JSON and load without migration; rules out a schema migration or backfill for existing runs.

## Task checklist

- Extend the review and review-debate branches of `buildWorkflowSnapshot` to persist optional `fixCommand` and `readyCommand` from the admitted step.
- Add a round-trip regression in `workflow-runner-core.test.ts` that drives stamped review and review-debate steps through `executeWorkflow`, persists the resulting `workflowSnapshot`, reopens the store, and asserts gate commands on the review-shaped snapshot steps.
- Add a legacy-snapshot load regression with review-shaped steps that omit gate-command fields.

## Acceptance criteria

- [ ] `v2/src/execution/workflow-runner-core.test.ts` proves a stamped `review` step and a stamped `review-debate` step each retain configured `fixCommand` and `readyCommand` on the persisted `workflowSnapshot` through store reload; the test fails against the pre-fix write-only `buildWorkflowSnapshot` branch reachable on main.
- [ ] `v2/src/persistence/state-store.test.ts` proves a workflow snapshot whose review-shaped steps omit `fixCommand` and `readyCommand` loads without error; the test fails if optional-field absence is rejected.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.

## Documentation updates
