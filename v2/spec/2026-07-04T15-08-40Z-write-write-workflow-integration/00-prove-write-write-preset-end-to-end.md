# Prove the write→write preset end to end

The prior slices landed the workflow runner, named presets, role→model
resolution, and workflow-load validation independently. This slice proves they
compose: a named `write-write` preset runs both steps through the real
workflow-runner path, step-local write loops complete in order, and durable
state records each step's attempts separately.

## Decisions

- Cover the proof in `workflow-runner.test.ts`, not a new ad hoc harness, because the contract under test is runner composition rather than a second invocation surface.
- Drive both steps through real `role`→binding resolution plus outer agent fallback, not precomputed `bindings`, because the wrong alternative would miss the integration the intent is proving.
- Keep the preset on `implement` for both steps, not mix roles speculatively, because the first consumer only needs proof that one executable role composes across two write steps.
- Prove per-step durability by querying `(project, branch, stepId)` history for both steps after one workflow run, not by asserting only the returned `WorkflowResult`, because the wrong alternative would miss the durable-state contract.
- Update `v2/docs/workflow-runner.md` as the workflow behavior home and `v2/docs/state-store.md` as the durable-state home, not subspec prose only, because operator/runtime semantics changed observably.
- Deferred to first consumer: whether later presets may mix distinct roles, prompts, or behaviors across positions beyond `write-write` — pin when a caller needs it.

## Task checklist

- [ ] Add an end-to-end `write-write` workflow-runner test that resolves the named preset, runs step one to completion, advances to step two, and completes step two through resolver-produced bindings.
- [ ] Make the test exercise project agent fallback inside the workflow path so at least one step proves quota fall-through before succeeding on a later binding.
- [ ] Assert that durable state records independent run/attempt history for both `(project, branch, stepId)` entries after the workflow completes.
- [ ] Update the durable docs in the same subspec.

## Documentation updates

- Update `v2/docs/workflow-runner.md` with the end-to-end `write-write` contract: preset resolution feeds real role→binding resolution per step, completion of one step advances to the next, and workflow-level success means both step-local write loops completed.
- Update `v2/docs/state-store.md` to make the multi-step durable-history example explicit for a two-step workflow run.

## Acceptance criteria

- [ ] A named `write-write` workflow run resolves each step's `role` against the loaded agent/model config, executes step one's write loop to `complete`, then advances and executes step two's write loop to `complete`.
- [ ] The workflow path honors project agent fallback inside step execution, so quota on an earlier binding can fall through to a later binding without preventing the two-step workflow from completing.
- [ ] After a successful two-step workflow run, durable state shows separate completed history for both `(project, branch, stepId)` entries rather than one shared run record.
- [ ] `v2/src/execution/workflow-runner.test.ts` stays green with the added end-to-end proof.
