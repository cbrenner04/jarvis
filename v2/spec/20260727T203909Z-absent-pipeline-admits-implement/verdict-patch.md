Reviewing implementation against the spec to ground the verdict.
## Verdict — required outcomes

### 1. Absent-key skip must not apply when the project record is missing or unreadable

**Outcome:** Implement admission treats **only** a defined `projects.<key>` object with **no `pipeline` key** as “no pipeline selected” and skips resolution. When `readProjectConfigRecord` returns `undefined` (missing key, non-object entry, or unreadable record), admission must **not** silently admit legacy implement by skipping resolution.

**Rationale:** The subspec defines optional pipeline via `'pipeline' not in project` on the raw project object. Folding `project === undefined` into the skip path changes behavior outside that decision: callers would get legacy implement without `pipelineDefinition` instead of the prior resolver path (`pipeline: undefined` → `invalid-project-pipeline-config`) or another explicit error. That widens the fix beyond “absent key admits implement.”

**Acceptance signal:** Guard inversion on the absent-key case still turns the unit and workflow siblings RED; behavior for unreadable/missing project records is intentional (documented in code or covered by a test if the actuator chooses resolution/error over silent skip).

---

### 2. Workflow integration test must assert omission of `pipelineDefinition`

**Outcome:** The sibling test in `"project pipeline selection gates implement before durable admission effects"` that drives implement with a pipeline-free `projects.demo` entry must assert that the built implement workflow has **no** `pipelineDefinition` (not only exit `0` and durable admission effects).

**Rationale:** The subspec’s unit AC explicitly requires `ok: true` without `pipelineDefinition`; the workflow AC names durable admission through that describe block and pairs with inversion on both tests. The integration seam currently does not verify the admission artifact the patch introduces; a regression could still pass durable effects if `pipelineDefinition` were wrongly attached. The test name already claims that omission.

**Acceptance signal:** Failure to attach or assert `pipelineDefinition` on the omit-pipeline workflow path fails CI; valid-path cases that expect a named pipeline still pass.

---

### No other mandatory actuator work

Docs (`install-and-config.md`, `workflow-runner.md`, `v1-behaviors.md`), preservation ACs, resolver behavior for present/malformed `pipeline`, and the `readProjectConfigRecord` + `'pipeline' in project` mechanism satisfy the completed subspec. Remaining advocate items (`projectRegistry` gate vs docs, `intent.md` drift, `pipeline: null` admission test, stale completed subspec, `agentModelConfig` ordering) are pre-existing, optional polish, or out of this subspec’s documentation list—not merge blockers for this patch.