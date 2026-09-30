# Entry-complete missing durable row rollup

## Problem

`resolveWorkflowRunRollup` (`v2/src/persistence/workflow-run-status-rollup.ts`) returns `killed` for any authored durable step with no sibling run row in a non-live invocation. After `pipeline resume` reopens an implement stage, a fresh invocation can complete the entry `implement` row with `terminalCause: "complete"` without ever creating a row for a later durable successor (gate-only completion; review already settled for the lane). Rollup then reports `killed` while the entry row honestly completed.

## Decisions

- Missing-durable-row relief uses strict `entryRun.terminalCause === "complete"` only — rules out inferring relief from `status: "completed"` or treating null/unset `terminalCause` on a completed entry as equivalent to `"complete"` (pre-migration rows keep missing-successor `killed`).
- In a non-live invocation, an authored durable step with no run row rolls up `completed` (continue the durable walk) when the entry run has `terminalCause: "complete"`, instead of returning `killed` immediately — rules out treating every missing durable row as daemon death between steps.
- The predicate keys off entry `terminalCause: "complete"`, not entry `attemptCount` — rules out coupling legitimately skipped successors to zero-attempt fixture setup.
- When `entryRun.terminalCause !== "complete"` (including null/omitted on an otherwise completed entry), a missing durable row still returns `killed` — rules out treating aborted or incomplete invocations as success when a successor never ran.
- Reopened implement without an `implement-review` row is one motivating scenario, not a special case — rules out a step-id-specific carve-out.
- Linked-implement partial routing (`linkedRoutingFinished`, missing shrink/later-step evidence) stays unchanged — rules out folding skipped-successor relief into link routing semantics.
- `v2/docs/workflow-runner.md` is the durable home for the missing-durable-row entry-complete rule; `v2/docs/pipeline-execution.md` merge-day settlement rollup prose stays unchanged — rules out duplicating the rule there or assuming its rollup paragraph is the full operator surface.

## Tasks

- [ ] In `resolveWorkflowRunRollup`, when an authored durable step has no row and `isLive` is false, return `killed` only if the entry run's `terminalCause` is not `"complete"`; otherwise continue the durable walk.
- [ ] Add or adjust unit tests in `workflow-run-status-rollup.test.ts` per acceptance criteria; for cases that should roll up `completed` under the new rule, set `terminalCause: "complete"` on the entry row (fixtures today omit it); flip expectations only where entry carries that cause (e.g. `"returns killed when an authored durable step has no row in non-live invocation"`, legacy-durable variant, durable `review-debate` missing row when updated).
- [ ] Update module doc-comment on `resolveWorkflowRunRollup` if it still claims every missing durable row is `killed`.

## Acceptance criteria

- [ ] `workflow-run-status-rollup.test.ts` adds a case where the entry step row is `completed` with `terminalCause: "complete"`, a later authored durable step has no run row (zero entry attempts only as fixture setup), and rollup is `completed`; it fails against the pre-fix `killed` expectation.
- [ ] `workflow-run-status-rollup.test.ts` pins a constructible case where a durable successor has no row while the entry lacks `terminalCause: "complete"` (e.g. null `terminalCause` with `status: "completed"`, or an explicit non-complete cause) and rollup stays `killed`.
- [ ] `workflow-run-status-rollup.test.ts` linked-implement describe block stays green.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — non-live rollup: a missing durable row is not `killed` when the entry row completed with `terminalCause: "complete"`.
- `v2/docs/v1-behaviors.md` — align the daemon `wait`/`list` durable-step rollup bullet with the same rule (including legacy missing-durability-metadata steps).
