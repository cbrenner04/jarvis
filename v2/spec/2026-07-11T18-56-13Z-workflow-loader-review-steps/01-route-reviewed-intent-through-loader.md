# Route reviewed intent through workflow loading

Make the reviewed-intent builder assemble its write and review source steps,
then use one `loadWorkflowSteps` call to materialize machine-derived bindings.
Keep its reviewed workflow composition and pre-daemon failure result unchanged.

## Prerequisites

- `loadWorkflowSteps` accepts authored `review` steps.

## Decisions

- Load the reviewed builder's write and review source steps together in one call; rules out separate builder-owned review configuration loading.
- Preserve the existing review prompt, verdict path, cycle count, and deferred-intent-output composition after loading; rules out changing reviewed-intent semantics while moving the configuration boundary.
- Convert loader failures to the existing `{ ok: false; error }` result; rules out throwing builder configuration failures to callers.
- Keep zero review passes delegated to the split-only builder before review loading; rules out making the no-review path require critic or actuator bindings.

## Task checklist

- [ ] Refactor reviewed-intent assembly so both source steps flow through the loader and preset resolution still receives loaded write steps.
- [ ] Remove duplicate review-specific machine configuration and role-binding resolution from the builder without changing its dependency-injection boundary more than needed for the loader pipeline.
- [ ] Update focused reviewed-intent builder tests for shared loading, preserved review composition, and loader failure results.
- [ ] Update the reviewed-intent builder pipeline documentation.

## Acceptance criteria

- [ ] A positive-pass reviewed intent returns the existing write-plus-review composition, with both steps' machine-derived bindings supplied by one workflow-loader call.
- [ ] A review binding or model-config load failure returns the builder's existing caller-facing `{ ok: false; error }` result before daemon contact.
- [ ] Zero review passes continues to return the split-only workflow without review configuration loading.
- [ ] `v2/src/execution/intent-workflow-steps.test.ts` covers shared loader use, preserved positive-pass review composition, and loader failure propagation.
- [ ] `v2/docs/workflow-runner.md` documents that reviewed intent loads its composed write and review source steps together, so machine configuration and review-role validation have one pipeline.

## Documentation updates

- `v2/docs/workflow-runner.md` — document reviewed-intent's shared loading pipeline.
