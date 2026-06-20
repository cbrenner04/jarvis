# Verdict

The consolidation premise is sound and most of the spec holds. But the spec asserts "preserve behavior verbatim" while leaving two behavioral divergences unsettled and carries a factual error in its doc-update task. It needs a refinement pass before it is implementable without guessing. Required refinements:

## 1. Pin the duplicate-`## Blocker` selection rule (must fix)
The two pre-existing blocker scanners disagree on which match wins when a document has more than one `## Blocker`: one records the last occurrence, the other returns the first. The spec's "one extraction path, preserve both shapes verbatim" decision only resolves the empty-body shape difference — it is silent on selection order. Because the shared helper unifies these into one path, the implementer must choose a rule, and the spec's own "patch unchanged / plan unchanged" criteria would both be claimed true while one consumer silently flips.

**Outcome:** Add an explicit decision stating which selection rule both consumers adopt, and add a shared-suite test pinning duplicate-`## Blocker` behavior for each consumer (`parseSpec` and `detectBlocker`).

## 2. Pin duplicate-`## Acceptance criteria` selection (fold in with #1)
The acceptance-criteria scan has the same unguarded last-wins pattern. Single consumer, lower risk, but the same shared restructure touches it and `v1-behaviors.md` couples the two sections under one `[uncertain]` note.

**Outcome:** Resolve it alongside #1 with a test in the new shared suite so the work clears the `[uncertain]` flag rather than carrying it forward.

## 3. State the warning-emission boundary (must fix)
Near-miss-heading parser warnings exist only on the spec parser; the standalone blocker detector has no warnings channel. "Share one extraction helper" leaves room for an implementer to hoist warning emission into the shared path and leak warnings into plan's gate.

**Outcome:** Add a one-line decision: the shared helper does body extraction only; near-miss heading warnings remain a `parseSpec` concern and `detectBlocker` stays warning-free.

## 4. Correct the doc-update citation (must fix — factual error)
The documentation-updates task instructs updating a `plan/blocker.ts` citation in `v2/docs/v1-behaviors.md`, but that file is never cited there. The actual citations are to `patch/spec.ts` (lines 308/313/314/334) and `patch/blocker.ts` (314).

**Outcome:** Repoint the doc-update task at the lines that actually exist, and have it resolve the `[uncertain]` entry (line 334) once #1/#2 pin the duplicate-section behavior.

## 5. Close the test-repointing scope gap (must fix)
The checklist's "repoint patch call sites" lists source files only, but `spec.test.ts` imports `parsePatchSpec` directly and breaks the moment `patch/spec.ts` is deleted (it is not a blocker test, so "fold blocker tests" does not cover it). Separately, `shrink.test.ts` imports the `AcceptanceCriterion` type through `subspec.ts`, making that re-export chain load-bearing.

**Outcome:** The checklist must explicitly cover migrating/repointing `spec.test.ts` to the shared suite, and must state the decision for the shared types: either `subspec.ts` re-exports them (keeping `shrink.test.ts` green) or those imports get repointed.

## 6. Name the legacy-helper destination (recommended, not blocking)
Relocating the plan-policy helpers (`isLegacyReviewGateBlocker`, `hasGenuineBlocker`) out of `shared/` is correct. Their destination is a legitimate defer-to-first-consumer choice, but both call sites (`draft.ts`, `review.ts`) are already known, so naming the target module costs nothing and removes implementer guesswork.

---

Items #1–#5 are required; the spec currently claims settled behavior it has not settled (#1–#3), contains a factual error (#4), and under-scopes the mechanical work its own acceptance criteria depend on (#5). #6 is a cheap tightening. The `shared/**` placement, dead-wrapper deletion, no-shim approach, `parsePatchSpec → parseSpec` rename, triage's transitive reach, and the structural acceptance criteria are all sound as written and need no change.