## Verdict — required outcomes before merge

### Merge blockers

1. **`v1/docs/config.md` must render as valid documentation.** The `subRoleAgentOrder` example JSON fence is unclosed; everything from `## worktreeSymlinks` onward is trapped inside the code block. Close the fence so the example ends cleanly and later sections are normal prose again. Subspec `01` AC requires `config.md` to be complete and free of removed-floor symbols; a broken fence fails that contract regardless of symbol scrubbing.

2. **`v2/docs/v1-behaviors.md` must not list `floor-error` as a current patch exit reason.** The patch run-summary failure-exit routing bullet still enumerates `floor-error` alongside live reasons. Code removed that path and its mapping; subspec `01` AC requires no residual floor references in `v1-behaviors.md`, and subspec `00` AC requires `floor-error` to be gone from the documented run-summary surface for new runs. Update the enumeration to match exit reasons the harness still emits.

### Recommended (non-blocking)

3. **Remove floor-era wording in `shrink.ts`.** The comment referring to “eligible agents” predates removal of capability-floor filtering; it should describe the `reviewActuator` order the code actually uses.

### No action required

- Core removal (reject-at-load for `actuationCapabilityFloor`, `capability`, `patchActuator`; direct `agentOrder` resolution; shrink via `reviewActuator` with no empty-post-floor skip; `floor-error` path removal) matches intent and spec decisions.
- Abrupt config break without migration prose is spec-intended.
- Loss of `patchActuator` as a distinct impl-ladder override is spec-intended.
- `activeAgents[0]` vs `reviewActuator[0]` reuse on the completion path is pre-existing and out of scope.
- Historical telemetry rows may still replay stored `floor-error` strings; that is acceptable.
- Subspec `00` AC #8 overclaims “relocated” tier tests — deleted tests were floor-coupled; `run.test.ts` integration coverage and the new trivial-tier `buildActiveAgents` smoke test are sufficient for correctness. Optional hardening only: `standard`/`hard` `buildActiveAgents` unit tests, `capability` rejection on additional `validateAgentOrder` paths, shrink test for configs that previously hit empty-post-floor skip.
