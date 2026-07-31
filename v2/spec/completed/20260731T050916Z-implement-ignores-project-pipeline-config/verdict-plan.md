Verifying a few codebase details so the verdict matches actual behavior.
## Verdict: required spec refinements

1. **Collapse to one subspec.** Intent states splitting does not apply; the change is confined to implement preset admission (`execution-loop`). Replace `00-daemon` / `01-execution-loop` with a single subspec linked from `index.md`. No daemon production code changes; the split duplicates work, splits decisions from docs ACs, and blocks serial implement runs on a false module boundary.

2. **Decide malformed `projects.<key>` behavior.** Work currently says remove `rejects implement when the project config record is missing` without a replacement. Today a non-object registry entry refuses via pipeline resolution with `pipeline: undefined`. Intent scopes non-consumption of `pipeline`, not project-record validation. The spec must state one outcome:
   - **Relax:** implement does not validate project-record shape; remove the test; record in `v1-behaviors.md`, or
   - **Preserve:** keep a non-pipeline refusal when the matched key has no readable project record, with an AC naming the replacement test.

   "Remove or rewrite" without choosing is not implementable and risks contradicting `absent-pipeline-admits-implement` (which rejected treating `project === undefined` as admit).

3. **Add cite-style preservation ACs.** This spec reverses present-key resolution while preserving absent-key admission from the prior spec. Add preservation ACs that cite existing tests by name:
   - `implement-workflow-steps.test.ts` — `admits implement when the registered project omits pipeline` stays green.
   - `workflow.test.ts` — pipeline-free `projects.demo` sibling in the admission describe block stays green (still asserts no `pipelineDefinition`).
   - `pipeline.test.ts` — `rejects invalid project pipeline configuration before daemon connect` (empty-`name` case) stays green.

4. **Tighten new workflow ACs to assert no `pipelineDefinition`.** Stale-config CLI cases must require admission **and** omission of `pipelineDefinition` on the built workflow (same bar as the rewritten present+valid case and the absent-pipeline sibling). "Admits and dispatches" alone is insufficient.

5. **Rewrite inversion AC to name the production mutation.** Replace "guard that skips project-pipeline resolution" (absent-key vocabulary). The criterion should state that re-enabling the `resolveProjectPipeline` call in `admitProjectPipeline` turns the stale-config admission test RED.

6. **Rename the rewritten workflow describe block.** The `"project pipeline selection gates implement before durable admission effects"` title will misdescribe behavior after implement ignores project pipeline. Work/AC should require a rename reflecting non-consumption, not only assertion changes inside the block.

7. **Documentation updates must supersede contradictory passages.** Beyond appending "implement ignores `pipeline`," work must target sections that still claim conditional resolution:
   - `v2/docs/v1-behaviors.md` — present-key resolution narrative (line ~88).
   - `v2/docs/install-and-config.md` — shared implement / `pipeline start` resolution language.
   - `v2/docs/workflow-runner.md` — implement admission gate that validates when key is present.
   - `v2/docs/operator-runbook.md` — replace "optional for implement" with **ignored by implement**; `pipeline start` still requires a valid block.

8. **Unify decisions, work, documentation updates, and acceptance criteria in the single subspec.** All intent decisions, the full work checklist (code, tests, docs, `v1-behaviors.md`), and every acceptance outcome from intent must appear exactly once in that subspec—no orphaned docs-only slice.

9. **Optional but recommended clarifications (non-blocking if omitted):**
   - One work line: preserve `agentModelConfig` refusal independent of pipeline removal.
   - Prerequisites note: lands after merged `absent-pipeline-admits-implement` and deliberately reverses its present-key path.

**Rationale:** Items 1–8 align the draft with intent ("no split"), spec guidance (atomic subspec, cite-style preservation ACs, guard-inversion naming, docs parity for behavior changes), and implementability (malformed-record gap, `pipelineDefinition` omission on all new admission paths). Core behavioral goal—implement never touches `projects.<name>.pipeline`; `pipeline start` unchanged—is sound; these refinements remove structural and edge-case ambiguity before implementation.