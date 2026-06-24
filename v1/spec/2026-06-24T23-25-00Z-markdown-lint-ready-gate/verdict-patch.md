I verified the sibling-doc recitations directly. `workflows.md:78/190`, `worktrees-and-commits.md:116`, and `plan-mode.md:373` describe the ready pipeline as `check:fix → typecheck → test → check` — narrative summaries that already abstract `check:fix:unsafe` down to `check:fix` and collapse the fast/full tier distinction entirely. They are one step stale, but they are representative narratives, not the full-tier step contract.

## Verdict

No required outcomes.

Rationale:

- The behavior change lands correctly: `lint:md` is appended to the `full` tier after `check`, `fast` is untouched, and the pinning tests in `ready-script.sandbox-unrunnable.test.ts` (the `toEqual` array, the skips-install occurrence, and the test title) were updated to match.
- The load-bearing doc obligation — the "specs changing v1 behavior must update `v1-behaviors.md`" rule — is satisfied: both full-tier recitations in that parity baseline (review-phase baseline ~line 51 and ready-pipeline-order claim ~line 400) were updated with the `lint:md` step, leaving the "enforced by regression tests" clause intact. The run-loop ready-tier table was also updated.
- The green-on-merge guarantee is self-enforcing: the full tier lints `v1/spec/**/*.md`, including this spec's own files, so a checked AC#2 on a ready-eligible PR is itself the confirmation that the corpus passes clean. No additional regression test is meaningful for a "corpus is clean" property.
- The sibling narrative docs that still end their pipeline at `check` were not in the spec's enumerated `## Documentation updates` scope, and they already abstract step-level detail (`check:fix`, no tier split). Their staleness is a minor latent inconsistency suitable for a follow-up intent, not a defect in this spec's compliance. Forcing `lint:md` into an already-abstracted narrative would be inconsistent and expands scope beyond the spec.

The implementation matches its spec's defined scope. Ready stands.