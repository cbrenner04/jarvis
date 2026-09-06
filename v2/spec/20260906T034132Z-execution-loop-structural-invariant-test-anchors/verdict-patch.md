Verifying audit state and the resume-inventory implementation before issuing the verdict.
## Verdict

**Required before intent sign-off**

1. **Reconcile `v2/docs/structural-invariant-test-audit.md`.** Main inventory and re-key backlog disagree for completed work. Row `ex-wri-merge-base-titles` still shows the pre-re-key anchor (`SOURCE_BUCKETS`, `incidental | re-key`) while the code uses merge-base anchor discovery and missing-only checks. Backlog still lists `ex-wrrs-resume-extraction` and `ex-wlsl-fixture-golden` as `re-key` though their main rows are already `behavioral | n/a`. Until this is fixed, the intent-level criterion (“every execution-loop row tagged `re-key`…”) is false on paper.

2. **Correct audit helper names.** Rows for debate/resume extraction cite `readProductionExecutionSource`, which does not exist; tests use `listProductionExecutionSources` + `locateDiscoveredFile`. Fixture rows overstate `locateDiscoveredFile` where reads go through `readReviewMdLintFixture` / `readIntentSplitFixture` throwing `StructuralTestLocatorError`. Anchor-mechanism text should match actual entrypoints.

3. **Close subspec 05–07 task checklists.** Acceptance criteria are satisfied; task items (audit row re-key, manifest wiring, loud-failure routing) remain unchecked. Tick them when audit rows are updated.

**No code changes required**

- **Resume inventory global destination pool.** Subspec 07 narrows to missing-only preservation with surplus allowed; checking each anchor’s expected titles against the union of `workflow-runner-resume*.test.ts` leaf titles matches that acceptance criterion. Per-bucket destination file scoping was never enforced; the deliberate relaxation is surplus tolerance, not a spec miss.

- **Intent-split surface derivation, production guard module, exported `EXTRACTED_FROM_WORKFLOW_RUNNER` manifests, spec-guidance whole-body checks, fixture-id registries.** Aligned with subspec decision ledgers.

- **`write.test.ts` human-only marker narrowing.** Subspec 04 explicitly replaces phrase inventory with `readSpecGuidance()` containment plus retained forbidden-token absences.

**Acknowledged gaps — not actuator blockers**

- Pre-fix “fails against pre-fix pin” is mostly prose/counterfactual, not encoded regression tests.
- Render-coverage `invoked[index]` ordering assumes stable verifier iteration.
- Regex `function`-declaration matching and closed manifests remain pre-existing brittleness accepted by the registry model.