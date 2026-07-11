# Route reviewed intent through workflow loading

Make the reviewed-intent builder assemble its write and review source steps,
then use one `loadWorkflowSteps` call to materialize machine-derived bindings.
Keep its reviewed workflow composition and pre-daemon failure result unchanged.

## Prerequisites

- `loadWorkflowSteps` accepts authored `review` steps.

## Decisions

- Load one mixed write/review source list in exactly one call, then resolve presets from loaded write steps only; rules out separate role loading or passing review steps to write-only preset resolution.
- Forward the builder's machine config path, profile, and machines directory to that call; rules out silently using default machine configuration.
- Preserve the existing review prompt, verdict path, cycle count, and deferred-intent-output composition after loading; rules out changing reviewed-intent semantics while moving the configuration boundary.
- Expose unified loader failure text unchanged in `{ ok: false; error }`; rules out adding or dropping an `intent:` wrapper at the new boundary.
- Keep zero review passes delegated to the split-only builder before review loading; rules out making the no-review path require critic or actuator bindings.

## Task checklist

- [ ] Refactor reviewed-intent assembly so one mixed source list flows through one loader call and preset resolution receives only loaded write steps.
- [ ] Forward injected machine config path, profile, and machines directory through the loader seam; remove duplicate review-specific configuration and role resolution.
- [ ] Update focused reviewed-intent builder tests for the single mixed loader call, forwarded options, preserved composition, binding creation, and loader failure text.
- [ ] Update the reviewed-intent builder pipeline documentation.

## Acceptance criteria

- [ ] A positive-pass reviewed intent makes exactly one injected loader call containing its write and review source steps, then returns the existing write-plus-review composition with machine-derived bindings.
- [ ] The unified loader call receives the builder's machine config path, profile, and machines directory when supplied.
- [ ] A review binding or model-config load failure returns `{ ok: false; error }` with the loader's unchanged error text before daemon contact.
- [ ] Zero review passes continues to return the split-only workflow without review configuration loading.
- [ ] `v2/src/execution/intent-workflow-steps.test.ts` covers one mixed injected loader call, forwarded loader options, loader failure text, and preserves the review prompt, verdict/staging paths, deferred output, cycle count, and binding creation.
- [ ] `v2/docs/workflow-runner.md` documents reviewed intent's one mixed loading pipeline and `{ ok: false; error }` loader failures; `v2/docs/v1-behaviors.md` records the changed builder pipeline with sources.

## Documentation updates

- `v2/docs/workflow-runner.md` — document reviewed-intent's shared loading pipeline.
- `v2/docs/v1-behaviors.md` — record the changed v2 builder pipeline and governing sources.
