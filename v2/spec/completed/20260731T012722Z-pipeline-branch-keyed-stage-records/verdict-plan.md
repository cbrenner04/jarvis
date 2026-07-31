Validating key advocate claims against the codebase so the verdict is grounded.
## Verdict: required refinements before merge

### 1. Pin the `createPipelineStageBranch` public contract

The spec names the API but does not state enough for implementers or the downstream fan-out spec to rely on it. The spec must define, at minimum:

- Initial row state matches admitted stages (`pending`, null lifecycle fields).
- New branch rows copy the default sibling’s `position` for that `stageId`.
- The API applies to every authored stage row type (workflow and approval), not workflow-only.
- Duplicate `(pipelineId, stageId, branchKey)` and unknown `stageId`/`pipelineId` are refused with explicit errors (constraint-backed).
- The call returns the new row’s durable `id`, consistent with `createPipeline`.

**Why:** Without this, the subspec is not independently testable at the persistence boundary and fan-out cannot call storage without re-deriving semantics.

---

### 2. Acceptance criteria must exercise `createPipelineStageBranch` as the new-behavior surface

The two-branch-row AC proves storage shape but can pass if the non-default row is inserted by any means. Per spec guidance’s failing-test requirement for new runtime behavior, the spec must require that:

- The non-default branch row is created via `createPipelineStageBranch`.
- Inverting that path (e.g., duplicate `branchKey`, unknown `stageId`, or a stub that always throws) fails the test.

**Why:** The new public API is the behavioral deliverable; ACs must fail when it is missing or broken, not only when uniqueness collapses.

---

### 3. Add a migration upgrade acceptance criterion

Migration `020` appears in the task checklist but has no AC, despite replacing uniqueness on live `pipeline_stages` data. The spec must add an agent-verifiable criterion in the repo’s established shape: a pre-change fixture opens, upgrades through `020`, backfills `branch_key = 'default'` on existing rows, enforces `UNIQUE (pipeline_id, stage_id, branch_key)`, and can load pipelines afterward. Include an inverted guard (missing backfill or retained old `(pipeline_id, stage_id)` uniqueness) that fails the test.

**Why:** Schema migration is the highest-risk change in this slice; tasks alone do not pin upgrade correctness.

---

### 4. Define deterministic ordering when branch siblings share `position`

Dropping `UNIQUE (pipeline_id, position)` makes tie-breaking observable in `loadPipeline` / `listPipelines`, reopen analysis, and the enumeration preservation test. The spec must decide and pin secondary ordering for rows with the same `position` (stable sort by `branch_key`, with `"default"` first among siblings). The preservation AC and task checklist must account for updated enumeration expectations and query ordering.

**Why:** Without this, “ordered stages” is ambiguous once multiple rows share a position, and the cited preservation test can fail or pass for the wrong reason.

---

### 5. Scope documentation to persistence vs. unchanged execution

Doc updates must distinguish what this slice changes from what remains deferred:

- **`state-store.md`:** branch-keyed rows, revised uniqueness, `createPipelineStageBranch`, `updateStage` branch targeting, and that enumeration returns one entry per stored row (row count may exceed authored stage count when branches exist).
- **`daemon-host.md`:** persistence may store `downstreamInputs`; stage resolution and dispatch still use today’s `specPath`/single-input behavior until downstream-handoff/fan-out land.
- **`v1-behaviors.md`:** record branch-keyed persistence and that current execution still targets the default branch only.

**Why:** Prevents doc drift implying multi-input resolution or non-default branch execution ship in this slice.

---

### 6. Extend the task checklist for enumeration and mapping touchpoints

Add explicit tasks for updating `STAGE_COLUMNS` / row mapping, load/enumeration SQL (including secondary sort), and the preservation test’s fixture SQL for `branch_key`. Optionally name `write-loop.test.ts` among complete doubles to forward changed `StateStore` members.

**Why:** The preservation AC stays green only if these implied touchpoints are not left to discover at implementation time.

---

### Upheld deferrals (no refinement required in this spec)

- Fan-out execution, path-derived `branchKey` assignment, `specPath` → `downstreamInputs` rewrite, artifact semantic validation, and `reopenFailedPipeline` behavior under branched rows belong in downstream specs.
- `updateStage` defaulting omitted `branchKey` to `"default"` is an intentional compatibility bridge for current callers.
- `bun run test:v2` (without `test:integration:v2`) is sufficient for this store-only slice, provided complete test doubles forward new members.

---

### Optional strengthening (not blocking)

Naming new regression tests in ACs (enumeration-spec style) and an explicit AC that `createPipeline` admits `branchKey: "default"` would improve traceability but are not required if the migration and preservation criteria above already pin default-branch behavior.