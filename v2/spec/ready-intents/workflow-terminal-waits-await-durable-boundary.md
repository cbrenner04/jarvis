---
name: workflow-terminal-waits-await-durable-boundary
---

# workflow.test.ts entry-terminal waits await the durable boundary instead of a 5 s deadline

## Problem

The two `v2/src/commands/workflow.test.ts` failures in the co-scheduling incident — `after detach the workflow reaches workflow entry terminal while the launching CLI has already exited` and `attached run workflow waits through a multi-step workflow until the entry run is terminal` — both settle at exactly 5000 ms. They assert a durable outcome (the entry run is terminal) but wait on a wall clock, so any scheduling pressure turns a correct run into a red test. Isolating the file hides the symptom; it does not make the assertion deterministic.

## Decisions

- Both waits poll the durable terminal boundary (the persisted entry-run status) to completion rather than sleeping toward a 5 s deadline; the failure backstop is a raised per-test timeout on these two tests (5000 ms is bun's default, so polling alone changes nothing without it) and is never the success condition; rules out treating scheduling as the only lever for a test that can be deterministic.
- Scope is these two tests and `assertAttachedEntryTerminalWait` (the attached test's existing helper); the detach test's wait is fixed in place; rules out a sweep of every bounded wait in the v2 suite.

## Acceptance criteria

- [ ] Both named `workflow.test.ts` tests assert on the persisted terminal entry-run state; a test where the entry run reaches terminal only after more than 5 s fails against the pre-fix 5 s form and passes after.
- [ ] `v2/src/commands/workflow.test.ts` stays green in isolation (behavior otherwise unchanged).
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/test-writing.md` — prefer awaiting the durable boundary over a wall-clock deadline; when a bounded wait is unavoidable, the suite belongs in the declared isolation class.

## Prerequisites

- Ordering: land after `declared-isolation-class-for-wall-clock-bounded-suites`, whose declared isolation class and `v2/docs/test-writing.md` section this intent's doc update refers to.
- `assertAttachedEntryTerminalWait` exists in `v2/src/commands/workflow.test.ts`.
