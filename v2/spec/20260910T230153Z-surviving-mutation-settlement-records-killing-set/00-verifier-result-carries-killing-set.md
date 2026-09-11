# The surviving-mutation verifier result carries the killing set it ran and that set's observed result

`SurvivingMutationResult` in `v2/src/execution/diff-derived-mutation-verifier.ts` carries only `mutation`, `sourceSite`, and `dualConstraint`. Every caller therefore reports a survivor without saying which tests were resolved as the killing set, whether they ran, or whether the isolated confirmation re-run happened — the three facts an operator needs to repeat the flip-and-test by hand.

Widen the result so each surviving-mutation constructor records the resolved killing test paths it actually ran and that set's observed result.

## Decisions

- Fields are `killingTests: string[]` (worktree-relative paths) and `killingSetObservedResult: "passed-confirmed" | "passed-unconfirmed" | "not-run"`. Named `killingSetObservedResult`, not `killingSetResult`: `testCandidate` already binds a same-scope local `killingSetResult` to the raw `runMutatedKillingSet` outcome, a different value space, and reusing the name would collide.
- A single boolean `confirmed` would not distinguish "the set never ran" from "it ran once", which is the coverage-shaped-survivor case.
- Both fields are required on `SurvivingMutationResult`, not optional — optional fields would let a future constructor silently omit the evidence this spec exists to guarantee.
- `testCandidate`'s survivor gets `passed-confirmed` when the isolated confirmation re-run passed and `passed-unconfirmed` when confirmation was skipped for lack of deadline headroom — the deadline-skip path is exactly the weaker claim an operator must be able to see.
- `missingKillingTest` and `importerDiscoveryCapExceeded` record `killingTests: []` and `not-run`: no set was resolved, so no set was run.
- `missingRenderCoverage` has five call sites in `verifyChangedPrompts`. Four fire before any observer set is resolved or run (verification-cap/deadline exceeded, unreadable observer map, unmapped/empty observer list, escaping observer path); those record `killingTests: []` and `not-run`. Only the fifth, post-`verifyPromptRenderCoverage` site (`!renderedOutputObserved`, where the mapped observer tests actually ran and passed under the sentinel mutation) records the mapped observer paths and `passed-unconfirmed` — that path has no isolated confirmation re-run. Widen `missingRenderCoverage` to take the resolved observer paths as an optional parameter, passed only at that fifth call site.
- `non-terminating-mutation` results are unchanged; this spec is scoped to the surviving-mutation settlement named in the intent.

## Task checklist

- [ ] Add `killingTests` and `killingSetObservedResult` to `SurvivingMutationResult` and populate them at all four constructors (`testCandidate`'s `survivorResult`, `missingRenderCoverage`, `missingKillingTest`, `importerDiscoveryCapExceeded`).
- [ ] Thread the resolved observer paths into `missingRenderCoverage`, used only at its one post-resolution call site.
- [ ] Cover both `testCandidate` survivor paths (confirmed and deadline-skipped), both `missingRenderCoverage` shapes (sentinel-observed and pre-resolution), and the other coverage-shaped survivors in `diff-derived-mutation-verifier.test.ts`.

## Acceptance criteria

- [ ] A confirmed survivor from `testCandidate` reports the resolved killing test paths it ran and `killingSetObservedResult: "passed-confirmed"`.
- [ ] A survivor reported without the isolated confirmation re-run (insufficient deadline headroom) reports the same killing test paths and `killingSetObservedResult: "passed-unconfirmed"`.
- [ ] A `missing-killing-test` survivor reports an empty killing set and `killingSetObservedResult: "not-run"`.
- [ ] An `importer-discovery-cap-exceeded` survivor reports an empty killing set and `killingSetObservedResult: "not-run"`.
- [ ] A `missing-render-coverage` survivor from the sentinel-mutation site (mapped observer tests ran and passed under the mutation) reports the mapped render-observer test paths and `killingSetObservedResult: "passed-unconfirmed"`.
- [ ] A `missing-render-coverage` survivor from any pre-resolution site (verification cap/deadline exceeded, unreadable observer map, unmapped/empty observer list, escaping observer path) reports an empty killing set and `killingSetObservedResult: "not-run"`.
- [ ] `v2/src/execution/diff-derived-mutation-verifier.test.ts` gains tests asserting the killing set and observed result on a confirmed `testCandidate` survivor and on both `missing-render-coverage` shapes; they fail against the pre-change code.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

- [ ] `v2/docs/write-behavior.md` records that a surviving-mutation result carries the killing test paths it ran and that set's observed result, which observed result each survivor shape reports, and names the already-documented isolated-confirmation-re-run mechanism (§ mutation verification) as the rule these two `killingSetObservedResult` values formalize: `passed-confirmed` is the confirmed-isolated-rerun path, `passed-unconfirmed` is the documented skip-confirmation path (deadline headroom, or the render-observer sentinel path, which has no confirmation re-run at all).
- [ ] `v2/docs/v1-behaviors.md` records the widened surviving-mutation verifier result (existing behavior changed).
