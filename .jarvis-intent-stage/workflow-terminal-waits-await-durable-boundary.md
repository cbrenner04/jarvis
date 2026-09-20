---
name: workflow-terminal-waits-await-durable-boundary
---

# workflow.test.ts entry-terminal waits await the durable boundary instead of a 5 s deadline

## Problem

The two `v2/src/commands/workflow.test.ts` failures in the co-scheduling incident — `after detach the workflow reaches workflow entry terminal while the launching CLI has already exited` and `attached run workflow waits through a multi-step workflow until the entry run is terminal` — both settle at exactly 5000 ms. They assert a durable outcome (the entry run is terminal) but wait on a wall clock, so any scheduling pressure turns a correct run into a red test. Isolating the file hides the symptom; it does not make the assertion deterministic.

## Decisions

- Both waits poll the durable terminal boundary (the persisted entry-run status) to completion rather than sleeping toward a 5 s deadline; a timeout remains only as a failure backstop, not as the success condition; rules out treating scheduling as the only lever for a test that can be deterministic.
- Scope is these two tests and any shared wait helper they use; rules out a sweep of every bounded wait in the v2 suite.

## Acceptance criteria

- [ ] Both named `workflow.test.ts` tests assert on the persisted terminal entry-run state and pass with the process starved of scheduling time; a test exercising the wait helper under delayed terminal transition fails against the pre-fix 5 s form.
- [ ] `v2/src/commands/workflow.test.ts` stays green in isolation (behavior otherwise unchanged).
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/test-writing.md` — prefer awaiting the durable boundary over a wall-clock deadline; when a bounded wait is unavoidable, the suite belongs in the declared isolation class.

## Prerequisites

- The test runner isolates wall-clock-bounded suites from subprocess-spawning suites as a declared class in `scripts/test-slice.ts`.
- `v2/docs/test-writing.md` documents the declared isolation class.
