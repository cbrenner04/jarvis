# Retired prompt id invariant

## Withdrawn

Withdrawn as redundant and over-specified (operator-approved 2026-08-31). The real invariant — the three retired ids (`plan.prompt.review`, `patch.prompt.review`, `patch.prompt.review.critic`) absent from the live governed registry — is already guarded by `shared/prompts/registry.test.ts:81-83` (`expect(ids).not.toContain(...)`). The proposed whole-corpus exact-token scan added little over that and was fragile: legitimate survivors it did not allowlist include the regression pins themselves, all of `v1/spec/completed/**` (archived specs), a mock-registry fixture in `v2/src/execution/diff-derived-mutation-verifier.test.ts`, and `v2/docs/v1-behaviors.md`'s own sentence documenting the retirement. Subspecs 00 and 01 (artifact/registry removal and doc updates) landed in #3260; this guard slice is dropped. Revisit only if a dead id demonstrably re-enters the live registry despite the existing pins.

## Acceptance criteria

- [x] Withdrawn — no work; the live-registry invariant is covered by `shared/prompts/registry.test.ts`.
