Reviewing the codebase and related specs to validate the draft against intent and existing patterns.
## Verdict: required refinements

1. **Replace the `merge`/zero-approval-stages rule.** The subspec’s minimum conflict (“`merge` incompatible with zero `kind: "approval"` stages”) contradicts the product contract (`fast` + `merge` is valid: workflow-only stages with a merge terminal action) and downstream intents that drive all three actions on ordinary pipelines. The spec must define the real approval-policy conflict set—or commit to pinning it in the conflict AC’s fixture with an explicit, product-consistent rule—and must not forbid `fast` + `merge`.

2. **Pin the operator config shape in Decisions.** Slice 1b fixed `pipeline` as `{ name, reviewOverrides? }`; this draft defers the terminal-action key while requiring operator docs. Pin the key name and allowed values (`leave-draft`, `ready`, `merge`) in Decisions, matching the sibling resolution subspec. Intent’s “pin when admission parses them” is satisfied in this slice—deferral must not leave docs and parser unspecified.

3. **Extend parse-time negative coverage for `terminalAction`.** Decisions and acceptance must require the existing path-specific parse table (slice 1b pattern) to cover: missing required field, unknown value, and malformed types (null, empty, non-string). These failures must use `invalid-project-pipeline-config` with named paths and occur before registry lookup.

4. **State conflict validation contract.** The spec must fix: (a) which combinations are conflicts (not the placeholder rule), (b) error code and shape (`invalid-project-pipeline-config` with named conflicting fields vs `invalid-pipeline-definition`), and (c) ordering relative to lookup, override application, and `validatePipelineDefinition`. AC3’s inversion test is the pinning vehicle only once the rule is internally consistent.

5. **Align AC2 with the resolution module boundary.** “Before any pipeline row, worktree, or agent invocation” overshoots what `project-pipeline-resolution.test.ts` can prove. Reframe as the established side-effect-free guarantee: resolution failures return named errors and perform no admission effects; parse-shape failures precede lookup when parse order permits (lookup-spy pattern from slice 1b).

6. **Account for admitted-definition shape change in tasks and positive coverage.** Required `terminalAction` on admitted definitions (omitted from registry rows) will break the existing positive resolution test and compile/fixture surfaces. Tasks must call out forbidden-key loop update, fixture/type fallout, and rewriting the positive resolution expectation (composed definition includes `terminalAction`, no longer equals raw registry row). Copy-isolation AC must cover `terminalAction`, not only stages.

7. **Tighten or drop AC4.** The meta “inverting any guard fails a test” criterion is weaker than slice 1b’s per-guard mapping and overlaps AC1–AC3. Either map each guard (parse, compose, conflict, deep-copy) to a named test, or drop AC4 and rely on the three intent ACs plus slice 1b’s inversion precedent.

8. **Document the breaking config change.** Operator docs must state that `terminalAction` is required when `pipeline` is present, with a complete example—single-operator hand-edited config, no migration machinery.

### Rationale

Items 1–4 unblock implementability: the current conflict placeholder contradicts intent and the per-project-pipelines brief, and spec guidance requires failing-test ACs backed by a real, pinable rule—not a deferred matrix with a wrong minimum. Items 3–7 align with slice 1b’s established parse/ordering/isolation patterns and prevent AC wording that implies integration tests this subspec does not own. Item 8 closes the doc gap between deferred schema and required operator documentation.

**No split required.** Work stays one module-boundary subspec if the task checklist explicitly carries parse negatives, fixture fallout, and the positive-test rewrite.