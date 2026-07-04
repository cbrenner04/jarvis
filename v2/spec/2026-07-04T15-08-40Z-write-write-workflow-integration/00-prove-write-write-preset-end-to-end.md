# Prove the write→write preset end to end

The prior slices landed the workflow runner, named presets, role→model
resolution, and workflow-load validation independently. This slice proves they
compose: a named `write-write` preset runs both steps through the real
workflow-runner path, step-local write loops complete in order, and durable
state records each step's attempts separately.

## Decisions

- Cover the proof in `workflow-runner.test.ts`, not a new ad hoc harness, because the contract under test is runner composition rather than a second invocation surface.
- Prove each step performs its own execution-time `role`→binding resolution from the loaded project agent/model config, not one shared or precomputed binding chain, because two-step success alone would not rule out incorrect binding reuse.
- Keep the preset on `implement` for both steps, not mix roles speculatively, because the first consumer only needs proof that one executable role composes across two write steps.
- Make ordering observable in the proof, not inferred from final success, because the wrong alternative would not prove that step one completes before step two begins.
- Prove fallback through the loaded project agent/model config as reached by per-step role resolution inside workflow execution, not a workflow-only fallback seam, because this slice is proving composed resolution behavior.
- Prove per-step durability by querying `(project, branch, stepId)` history for both steps after one workflow run, not by asserting only the returned `WorkflowResult`, because the wrong alternative would miss the separate attempt-history contract.
- Update `v2/docs/workflow-runner.md` as the supported composed workflow behavior home and `v2/docs/state-store.md` as the supported durable-state behavior home, not subspec prose only, because this slice establishes observable runtime contracts rather than a private test proof.
- Deferred to first consumer: whether later presets may mix distinct roles, prompts, or behaviors across positions beyond `write-write` — pin when a caller needs it.

## Task checklist

- [ ] Add an end-to-end `write-write` workflow-runner test that proves both steps resolve `implement` through the named preset inside the workflow run, rather than reusing one binding chain.
- [ ] Make the test show step one completes before step two begins, then step two completes after advancement.
- [ ] Make the test exercise fallback from the loaded project agent/model config inside workflow role resolution so at least one step proves quota fall-through before succeeding on a later binding.
- [ ] Assert that durable state records independent per-step run and attempt history for both `(project, branch, stepId)` entries after the workflow completes.
- [ ] Update the durable docs in the same subspec.

## Documentation updates

- Update `v2/docs/workflow-runner.md` with the supported `write-write` composition contract: each step resolves its own `role` through the loaded project agent/model config at execution time, step two starts only after step one completes, and workflow success means both step-local write loops completed.
- Update `v2/docs/state-store.md` to make the supported two-step durable-state contract explicit: one workflow run yields separate per-step attempt history for each `(project, branch, stepId)` entry.

## Acceptance criteria

- [x] A named `write-write` workflow run proves each step resolves its own `implement` role against the loaded project agent/model config during workflow execution rather than reusing one shared binding chain.
- [x] In that run, step two does not begin until step one's write loop reaches `complete`, and the runner then advances and executes step two's write loop to `complete`.
- [x] The workflow path honors fallback from the loaded project agent/model config through per-step role resolution, so quota on an earlier binding can fall through to a later binding without preventing the two-step workflow from completing.
- [x] After a successful two-step workflow run, durable state shows separate per-step run and attempt history for both `(project, branch, stepId)` entries rather than one shared record.
- [x] `v2/src/execution/workflow-runner.test.ts` stays green with the added end-to-end proof.
