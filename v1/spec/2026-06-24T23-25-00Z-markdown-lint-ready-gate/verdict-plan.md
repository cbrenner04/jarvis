## Verdict

All five primary findings are upheld. The spec's core architecture — `lint:md` in the full tier only, last position after `check`, no retry wrapper — is sound and well-justified; refine only the completeness of the doc, test, and AC enumeration around it.

### Required refinements

1. **Enumerate both stale doc sites in `v2/docs/v1-behaviors.md`.** The full-tier sequence is recited in two places: the review-phase baseline (~line 51) and the ready-pipeline-order claim (~line 400, "install → check:fix:unsafe → typecheck → test → check ... enforced by regression tests"). The current doc-update bullet's singular phrasing invites editing one and stopping — exactly the baseline-rot the changes-existing-functionality rule guards against. Name both sites and scope the edit to the parenthetical step list only (the "enforced by regression tests" claim stays true and should not be rewritten).

2. **Add a positive green-on-merge AC.** The intent's load-bearing requirement — land only after the in-scope corpus passes lint clean — is a *positive* guarantee, but every current AC tests only the negative (violation → fail) or the unchanged fast tier. Add an AC asserting the unmodified in-scope corpus passes the full tier (gate green at merge). A prerequisite is not a contract; the one guarantee the intent explicitly names must be verifiable.

3. **Note the self-gating trap.** This spec wires the gate that then lints its own authoring artifacts: the lint globs cover `v1/spec/**/*.md` and no ignore pattern excludes the active spec directory, so the implementation run's full tier will lint these very spec files and any violation blocks the PR from going ready. Add a one-line implementer note that the spec's own files must be lint-clean. This is a note, not new scope.

4. **Fix the fast-tier preservation AC to cite its test.** AC#2 ("The `fast` tier is unchanged…") uses a preservation verb and paraphrases behavior instead of citing the pinning test in `v1/test/ready-script.sandbox-unrunnable.test.ts`. Per the refactor-AC convention it should be written as a citation ("…test stays green"); as written it trips the `missing-anchor-behavioral-ac` validator warning.

5. **Enumerate all test-update break sites.** "Update the tier-list assertions" undersells the work in `v1/test/ready-script.sandbox-unrunnable.test.ts`: the full-tier `toEqual` array, the second `["check:fix:unsafe", "typecheck", "test", "check"]` occurrence in the skips-install test, and — critically — the test **title** naming the full-tier steps, which becomes misleading and could be left unfixed. Call out all sites including the title.

### Optional (not required)

The feedback-latency tradeoff in the ordering decision and a "no `--fix` analog" note are both defensible to omit. The ordering is already justified by fix→verify sequencing; adding latency prose cuts against the repo's terseness ledger rule. Leave to the refiner's discretion; neither is a defect.