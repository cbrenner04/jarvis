Reviewing implementation and tests against the spec and acceptance criteria to issue a grounded verdict.
## Verdict: required outcomes before merge

### 1. Artifact acceptance criteria must be honestly testable

The round-trip test proves two-path persistence but does not satisfy the ticked guard-inversion criterion. Literal `not.toEqual` comparisons against a local variable are tautological and stay green if persistence is broken or weakened.

**Required:** Guard-inversion evidence for the two-path artifact behavior must tie to the round-trip regression itself (source mutation with a comment checkpoint per repo guard-inversion practice), not standalone literal comparisons. The primary regression must pin that the stored artifact is exactly two file paths (not one path, not a directory path, not omitted `downstreamInputs`). Do not add production invert flags or test-only bypass branches.

**Rationale:** Ticked spec ACs claim inversion guards; current tests overclaim. Repo guard-inversion standard rejects tautological “inversion” tests.

---

### 2. Branch guard-inversion criterion must be honestly testable

The named branch inversion test exercises error paths (duplicate key, unknown pipeline/stage) but does not demonstrate that removing, stubbing, or breaking `createPipelineStageBranch` would fail the primary branch-row regression.

**Required:** Branch guard-inversion evidence must be anchored on the primary “two branch rows…” test (mutation checkpoint or equivalent), proving that regression fails without a working `createPipelineStageBranch`. The separate inversion test may remain as error-path coverage but cannot be the sole satisfaction of the inversion AC.

**Rationale:** Spec AC explicitly requires inversion of the branch-row guard including API removal/stub behavior; the primary test already depends on the API, but that dependency is not presently verified as an invertible guard.

---

### 3. Position-tie ordering among branch siblings must be asserted

Spec decision: `loadPipeline` / `listPipelines` order by `position ASC`, then `branch_key ASC` with `"default"` first among ties. Implementation matches this, but no test inserts sibling branch rows at the same `position` and asserts read order.

**Required:** At least one test must create multiple branch rows sharing a `position` and assert `loadPipeline` (and ideally `listPipelines`) returns `"default"` before other branch keys.

**Rationale:** Dropping `UNIQUE (pipeline_id, position)` makes secondary sort observable; the enumeration preservation AC claims position-tie ordering but only exercises default-only fixtures.

---

### 4. `createPipelineStageBranch` contract must be pinned beyond distinct payloads

Spec defines initial admission state (`pending`, null lifecycle fields), position copy from the default sibling, applicability to workflow and approval rows, constraint-backed refusal, and returned durable `id`. Implementation appears correct; tests do not fully pin the contract.

**Required before merge:**

- Freshly created branch row (before any `updateStage`) is `pending` with null lifecycle fields and shares the default sibling’s `position` for that `stageId`.
- Branch creation succeeds on an approval authored stage, not only workflow stages.
- Returned `id` is already partially covered; admission defaults and approval path are not.

**Rationale:** Spec pins this API for downstream fan-out; persistence slice is not independently testable at the boundary without these assertions.

---

### 5. No action required on execution-layer branch safety

Creating non-default branch rows before fan-out lands can interact badly with today’s execution (`findStageRecord` is `stageId`-only, derivation walks all rows, etc.). That is a documented footgun, explicitly deferred by spec and docs (`daemon-host.md`, `v1-behaviors.md`). No actuator changes in daemon/execution are required for this slice.

**Rationale:** Scope boundary is persistence + admission API; production paths do not call `createPipelineStageBranch` yet.

---

### 6. No action required on store-level rejection of bad artifact shapes

`updateStage` stores artifact JSON opaquely; semantic validation of `downstreamInputs` is deferred to the first consumer. Tests must not imply the store rejects single-path or directory artifacts at write time unless validation is added (out of scope).

**Rationale:** Spec decisions defer consumer-side rewrite/validation; docs already describe opaque persistence.

---

### Non-blocking (actuator may fix opportunistically)

- Rename the duplicate-stage constraint test to reflect `(pipeline_id, stage_id, branch_key)` uniqueness.
- Use one shared source for the `"default"`-first SQL sort expression to avoid drift with `DEFAULT_PIPELINE_STAGE_BRANCH_KEY`.
- `pipeline-execution.test.ts` `fakeStore` omits `createPipelineStageBranch` but is a partial double behind a cast; acceptable while no execution test calls the API.