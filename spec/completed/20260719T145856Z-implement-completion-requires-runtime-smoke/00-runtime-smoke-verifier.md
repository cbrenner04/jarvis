# Runtime-smoke verifier

A standalone verifier that proves a run's changed production behavior is wired
into its runnable surface: it discovers the changed runnable entrypoint from the
production diff against the run base, executes that real entrypoint bounded and
non-destructively, and observes its runtime behavior. Net-new internal module;
its first consumer is subspec 01 (the mandatory completion boundary). Sibling to
the diff-derived mutation verifier, which proves guards are *tested* but cannot
prove they are *reachable at runtime*.

## Decisions

- Discover the smoke target from the `<runBase>...HEAD` production diff, selecting a changed runnable entrypoint; rules out smoking a fixed/default entrypoint blind to what the run changed.
- Execute the real discovered entrypoint and observe its runtime behavior; rules out invoking a test helper or the scoped-test runner in the smoke body, which would re-prove tests rather than wiring.
- Bound smoke execution by a wall-clock limit and run it non-destructively; rules out an open-ended or state-mutating production probe.
- A failed or timed-out smoke returns a failure naming the executed command and the failed observation; rules out a generic red result that hides which runtime evidence was missing.
- No discovered runnable surface returns a passing result recording the inspected changed paths and the discovery reason; rules out silently skipping discovery or treating not-runnable as a hard failure.
- Exercise git-diff and entrypoint execution through injected seams; rules out live subprocess spawning in unit coverage.
- Deferred to first consumer: exact runnable-surface discovery depth (declared-entrypoint match vs transitive reachability from a changed file) and the specific non-destructive invocation that still routes through the changed behavior — pin when the completion boundary wires it.

## Task checklist

- Add the verifier module under `v2/src/execution/` with git-diff and entrypoint-execution seams.
- Discover the changed runnable entrypoint from the run-base production diff; return a not-runnable pass when none is found.
- Execute the entrypoint under a wall-clock bound, non-destructively, and observe its behavior.
- Return a structured pass (observed-clean, or not-runnable carrying inspected paths + discovery reason) or a smoke failure (command + failed observation).
- Co-locate the test file next to the module.

## Acceptance criteria

- [x] The verifier discovers its smoke target from the `<runBase>...HEAD` production diff, selecting a changed runnable entrypoint rather than a fixed default surface.
- [x] The verifier executes the discovered real entrypoint and observes its runtime behavior, not a test helper or the scoped-test runner.
- [x] Smoke execution is bounded by a wall-clock limit and runs non-destructively; exceeding the bound ends the smoke as a failure.
- [x] A failed or timed-out smoke returns a failure naming the executed command and the failed observation.
- [x] A changed diff with no discovered runnable surface returns a passing result recording the inspected changed paths and the discovery reason.
- [x] A new co-located test drives the verifier through injected git-diff and entrypoint-execution seams to (a) a smoke-failure result for a changed entrypoint whose execution fails or times out, asserting the named command and observation, and (b) a not-runnable pass recording inspected paths and reason; it fails against the pre-fix tree (no verifier exists) and passes after.

## Documentation updates

- `v2/docs/write-behavior.md` — runnable-surface discovery, observation, bound, and not-runnable evidence contracts of the verifier.
