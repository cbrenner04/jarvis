# Make daemon workflow tests observable

## Problem

- Agent-runnable daemon tests use fixed delays to infer asynchronous workflow progress.
- Step 0 completion does not prove later review steps completed because each step has separate run evidence.

## Decisions

- Await asserted state, events, prompts, or completion evidence; rules out scheduler slack as synchronization.
- Keep bounded polling only when its predicate is the asserted observable condition; rules out unbounded spins and delay-only helpers.
- Inject clocks or pollers for daemon timing contracts, or mark irreducible real-clock coverage `.sandbox-unrunnable.test.ts` with rationale; rules out weakening timing assertions to retain agent routing.
- Pin multi-step review completion in `v2/src/execution/workflow-runner.test.ts` with review-step evidence; rules out using step 0's terminal row as a workflow-completion proxy.

## Work

- Classify timer-backed waits in agent-runnable `v2/src/daemon/**/*.test.ts` as condition polling, elapsed-time behavior, or fixed-delay synchronization.
- Replace fixed-delay synchronization and add the minimum clock or poller seams required for deterministic timing assertions.
- Add the review-completion regression and remove the daemon test's step-0-plus-delay assumption.
- Preserve production daemon and workflow semantics.

## Acceptance criteria

- [ ] Agent-runnable `v2/src/daemon/**/*.test.ts` waits for asserted observable conditions instead of fixed delays.
- [ ] `v2/src/execution/workflow-runner.test.ts` has a regression that fails against the pre-change step-0 completion inference and passes only with review-step evidence.
- [ ] Daemon tests whose contract is elapsed time use injected clocks or pollers; irreducible real-clock tests are marked `.sandbox-unrunnable.test.ts` and state why.
- [ ] Existing `v2/src/daemon/**/*.test.ts` and `v2/src/execution/workflow-runner.test.ts` stay green; production semantics are unchanged.

## Documentation updates

- None; this subspec removes nondeterministic test synchronization without changing the documented contract. Enforcement and operator guidance land in subspec 02.
