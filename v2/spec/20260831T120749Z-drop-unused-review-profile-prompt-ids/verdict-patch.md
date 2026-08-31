Reviewing the implementation against the spec and verifying the advocate's claims independently.
No required outcomes. The implementation matches the completed subspec: `promptIds` is removed from `ReviewPromptProfile` and all domain specs, scoped grep is clean under `shared/`, `v2/src/`, and `v2/docs/`, operator docs were updated as specified, and tests were adjusted without changing review dispatch behavior.

Remaining concerns do not require actuator action on this branch:

- Removing the profile-level `@mutate` pin and debate-id assertions was an explicit subspec decision; implement critic-id coverage remains on `review-implement.ts`, registry, and workflow tests.
- The stale survivor allowlist in `02-retired-prompt-id-invariant.md`, planning-doc drift, rehydration-doc inaccuracy, and the light-cycle test’s domain-profile choice are real follow-ups but outside this subspec’s scope and acceptance criteria; they do not block merge of this change.