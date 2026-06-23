## Verdict

The implementation faithfully realizes the spec's decisions; all acceptance criteria are met and the snapshot-over-allowlist design is correctly wired into both fresh-path sites with resume untouched. One narrow coverage gap is upheld as a required outcome; the remainder are not.

### Required outcome

1. **Prove snapshot *discrimination* through the full `planCommand` path with a single integration test.** Today the discriminating case — an external spec root that holds *both* legitimate pre-existing siblings (`ready-intents/`, a prior spec dir) *and* a sibling created during the run — is proven only at the unit level. The two integration tests each exercise one half (clean siblings pass; run-created escape fails), so the assertion that the snapshot *separates* the two through the real `run.ts` threading is never made end-to-end. Add or extend one `commit:false` integration test where the populated root also gains a run-created escape, and assert that only the new entry is flagged (exit 1) while the pre-existing siblings are not. This is exactly the layer where the threading is the genuine risk; the cost is one test.

   *Rationale:* the spec's central decision is that a pre-write snapshot discriminates siblings from escapes. Unit coverage of `assertNoCommitExternalSpecBoundary` plus separate single-sided wiring tests do not exercise that discrimination through the path operators actually run. This closes the gap without expanding scope.

### Not requiring change

- **Silent `undefined` fallback on `readdir` failure.** The `readdir` runs microseconds after a successful `mkdirSync` on the same path in the same process; the failure mode over-flags (fail-safe-strict for a boundary guard), never under-flags. Defensible within scope.
- **Persisted-escape snapshot poisoning.** Already on the record as a conscious trade-off (Decision §5; `revertPaths` gated on `commit`). Code matches the stated disposition — not a deviation.
- **Operator-cleanup / poisoning caveat in `plan-mode.md` and `v1-behaviors.md`.** Surfacing it operator-facing is a reasonable enhancement but exceeds the spec's stated documentation scope ("allows pre-existing siblings, flags new ones"; "permits pre-existing sibling entries"). Optional, not required.
- **Redundant-looking unit tests.** They pin the no-snapshot (`undefined`) fallback's safe direction, a real branch — keep.