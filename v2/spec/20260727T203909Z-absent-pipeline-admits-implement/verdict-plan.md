Verifying key codebase claims so the verdict is grounded.


## Verdict: required spec refinements

1. **Unit acceptance criterion must force real pipeline admission**  
   The new `implement-workflow-steps.test.ts` case must use inputs where `admitProjectPipeline` actually runs (today gated on `input.projectRegistry !== undefined`). The AC should state that explicitly—e.g. CLI-shaped build input with `projectRegistry` set and a matched project whose config record has no `pipeline` key—not only “matched project” prose. Keep the requirement that the test **fails on current `main`**, so a hollow case that never reaches resolution cannot satisfy the AC.

2. **Work / decisions must pin how “absent key” is detected**  
   The spec already requires `'pipeline' in project` on the raw `projects.<key>` object. Add an outcome that the absence signal cannot be inferred solely from `readProjectPipelineConfig` returning `pipeline: undefined` (that shape conflates missing key with other reads). The implementer must obtain key presence from the raw project record (loader extension or equivalent) while keeping resolver behavior for explicit `undefined`/`null` fragments unchanged.

3. **Extend documentation updates to `v2/docs/workflow-runner.md`**  
   The implement-admission section still describes always reading/resolving `pipeline` and refusing before daemon effects. After this change, absent `pipeline` skips resolution and legacy implement proceeds. Documentation updates must include aligning that narrative with conditional admission (resolution/errors only when the key is present).

4. **Address `v2/docs/v1-behaviors.md` per harness guidance**  
   This changes default implement behavior for the common registry shape (no `pipeline` key). Documentation updates must either record optional `pipeline` and absent-key = legacy implement without `pipelineDefinition`, or state explicitly why the parity catalog is unchanged, with a one-line rationale.

5. **Guard-inversion AC should cover both new failing tests**  
   The inversion criterion should name both the new unit test (`admits implement when the registered project omits pipeline`) and the new or extended `workflow.test.ts` sibling in the `"project pipeline selection gates implement before durable admission effects"` block, so both guards are covered per spec guidance on inverted guards.

**Rationale (brief):** Items 1 and 5 tie new behavior to tests that fail pre-fix and prove guard necessity. Item 2 prevents a correct-looking skip that uses the wrong signal. Items 3–4 keep operator and parity docs consistent with a behavior change that is not purely additive.

**Not required for merge (optional polish):** stricter “property absent vs. `undefined`” wording on success results; restoring `## Prerequisites` on the subspec; a dedicated AC for `pipeline: null`; a decision on non-object `projects.<key>` entries. The advocate’s defense of preservation ACs by test citation and single-subspec structure stands—no split.