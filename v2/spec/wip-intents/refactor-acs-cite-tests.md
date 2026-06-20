# Refactor ACs cite existing tests instead of paraphrasing behavior

## Problem

For behavior-preserving refactor specs, an acceptance criterion that *paraphrases* current behavior ("plan stops on a hard error") can assert a falsehood the author never verified. Paraphrasing is where wrong claims enter: the author restates what they assume the behavior is, without locating the test that pins it.

## Evidence (this session)

The `shared-invocation-executor` spec (D) had a subspec-00 AC stating terminal `error` stops the fallback chain for plan paths. The pre-existing `plan-draft-hard-error-continue.test.ts` proves the opposite — plan-draft advances to the next agent on a hard error. The implementation agent then fought its own spec, globally corrupting the shared executor's `quota-only by design` contract to preserve plan's behavior, and left the suite red. The contradiction was invisible at plan time because the AC paraphrased behavior instead of citing the test that establishes it.

## Direction

`v1/docs/spec-guidance.md` convention: for behavior-preserving refactors, write ACs as **"`<existing-test>` stays green"**, not as a prose restatement of what that test asserts. Writing the AC forces the author to locate the pinning test, which surfaces the real behavior and prevents inventing a contradictory claim. Genuinely new behavior still gets prose ACs plus new tests.

Enforcement is deferred to consumers, not owned here: the plan-draft validator can flag a behavioral/preservation AC that cites no test or source anchor ([[plan-draft-structural-validation]]), and an implementation-side guardrail can block when satisfying an AC requires changing a pre-existing test.

## Out of scope

- How ACs are ticked (unchanged).
- The validator and implementation guardrail themselves — this seed is the convention; enforcement lands in [[plan-draft-structural-validation]] and patch rules.
