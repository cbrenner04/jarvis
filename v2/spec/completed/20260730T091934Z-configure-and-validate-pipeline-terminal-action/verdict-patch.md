Reviewing the implementation and docs against the spec to issue an outcome-focused verdict.
## Verdict

1. **Correct operator scope for `projects.<key>.pipeline` in `v2/docs/install-and-config.md`.** The pipeline table still reads as if the fragment applies only to implement admission (“when absent, implement admission skips pipeline resolution”). That is incomplete for this slice: when `pipeline` is present, required `terminalAction` is enforced anywhere project-pipeline resolution runs — at minimum `jarvis pipeline start` and implement admission — via the same resolver and the same breaking hand-edited config rule already documented for the field itself. Operator config for the breaking change must name both entry points (or state the shared resolution boundary without implement-only framing).

**Rationale:** The subspec requires operator documentation for the breaking `terminalAction` requirement, validation, conflict semantics, and a complete example. The field-level docs satisfy that; the section intro still misstates when the fragment is consumed, which can mislead operators configuring `pipeline` for pipeline start.

---

**No other required outcomes.** Resolution behavior, parse/lookup ordering, implement-stage conflict rule (`fast` + `merge` valid), copy isolation, inversion pinning, fixture fallout, and the three acceptance tests align with the subspec. Gaps below are optional hardening, not merge blockers:

- CLI/integration rows for missing `terminalAction` or implement-stage conflict (same path as existing empty-`name` coverage).
- Parametrizing conflict failures over all three terminal actions (guard is action-agnostic; inversion + one failure path pin it).
- A separate admitted-definition type or validator requirement for `terminalAction` (deferred “as needed”; resolution always sets it on success).
- Sharpening “optional `terminalAction`” wording in `workflow-runner.md` (already qualified as resolution-supplied on admitted definitions).
- Renaming the AC2-named unit test for accuracy (cosmetic).
- Documenting conflict-vs-definition-validation short-circuit beyond the precedence chain already in `workflow-runner.md`.