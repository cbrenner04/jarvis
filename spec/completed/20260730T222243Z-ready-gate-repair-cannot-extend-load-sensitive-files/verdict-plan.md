# Verdict: required refinements

## Required before implement

1. **Invert seam contract** — AC2 must pin how the membership guard is disabled for regression proof: either a dedicated test-only invert separate from the path-fence invert, or an explicit decision that path-fence inversion does not disable the membership guard. Without this, AC2 is ambiguous and may be satisfied by coupling both guards to one flag.

2. **Documentation acceptance criteria** — Add agent-verifiable ACs for all three listed doc updates (`v2/docs/test-writing.md`, `v2/docs/write-behavior.md`, `v2/docs/v1-behaviors.md`). Spec guidance treats docs as part of the deliverable; sibling fence subspecs already model this.

3. **Non-growing allowance AC** — Strengthen the third AC to name its test and describe observable setup: `scripts/test-slice.ts` is in the frozen run-diff allowset, staged edit changes the file without growing `LOAD_SENSITIVE_FILES` membership (comment-only or reorder is the natural case), repair completes. Mirrors the named rejection test and intent’s “don’t ban legitimate module edits” complement.

4. **Membership extraction contract** — Add a decision bounding comparison to the set of string literals in the `LOAD_SENSITIVE_FILES` binding at `<baseRef>` vs staged worktree content—not full TypeScript semantics, reorder, or comment-only churn. Implementers need a clear contract for what “adds a path” means.

5. **Removal semantics** — State explicitly whether repair may remove entries from `LOAD_SENSITIVE_FILES`. Intent blocks growth only; the spec should record that removals are permitted (or blocked) so operators and implementers share the same policy boundary.

## Recommended (not blocking)

6. **Recovery coverage or integration anchor** — Either pin the guard to `validateReadyGateRepairCompletion` (shared by first repair and persisted-fence recovery) in Decisions, or add one recovery-path regression showing load-sensitive rejection survives resume/retry. Architectural placement alone does not prove the guard runs on all entry points.

7. **Benign-churn positive case** — A reorder/comment-only repair that completes would lock the “membership-only, not mere file touch” decision and guard against sloppy implementations.

8. **Problem statement accuracy** — Drop or generalize the “three files” count if it no longer matches committed state; incident motivation should not assert a stale number.

## Out of scope (no refinement required)

- Fencing all load-sensitivity bypass vectors (e.g. edits to `isLoadSensitive()` without array growth) — incident-scoped to `LOAD_SENSITIVE_FILES` set growth; broader policy is a follow-on if desired.
- Path-level error evidence — optional polish; `completion_commit_failed` before republish satisfies intent.
- Prerequisite echo in the subspec — helpful hygiene only; prerequisite is satisfied in code.
- Scoped typecheck/test ACs — repo `AGENTS.md` already governs implement-time verification.

## Rationale

Refinements 1–5 close gaps that would strand implementers (ambiguous invert), leave docs unticked (spec guidance), or allow divergent interpretations of the guard’s predicate and policy (extraction, removals, positive allowance). The spec’s core scope—reject repair-time growth of `LOAD_SENSITIVE_FILES` while preserving ordinary path-fence behavior for non-growing edits—is sound and aligned with intent; these refinements make that scope testable and complete without expanding it.