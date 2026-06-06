# Shared review write-boundary detection

Both review loops detect out-of-boundary writes by an agent the same way — walk `git status --porcelain`, filter paths — but in parallel copies:

- Plan: `validateReviewOutput` / `isValidIntentModification` (`v1/src/modes/plan/review.ts`) — `intent.md` frozen except an appended `## Blocker`, `index.md` must still exist; reaction = return an error string.
- Patch: `detectSpecTreeEdits` / `revertSpecTreeEdits` (`v1/src/modes/patch/review.ts`) — the whole spec subtree frozen, no blocker append; reaction = revert (checkout + clean).

Lift the shared *detection* into a new v1 module and have both modes call it, keeping each mode's *reaction* (plan errors, patch reverts) at the call site.

## Decisions

- New module `v1/src/modes/review/boundary.ts` (creates the `v1/src/modes/review/` home the intent names; stays in v1, not `shared/**` — no v2 consumer and it would need `v1/**` imports). Rules out extending `plan/boundary.ts`, which owns plan's *general* draft/commit boundary, a different concern.
- One parameterized detector over `git status --porcelain` taking `{ cwd, frozenPaths, blockerAppendAllowed }` and returning the offending (out-of-boundary or disallowed-modification) paths plus, when `blockerAppendAllowed`, whether the only frozen-file change was an appended `## Blocker`. Rules out two detectors that differ only by constants.
- Plan binds `frozenPaths = [intent.md]`, `blockerAppendAllowed = true`, and additionally asserts `index.md` exists (kept plan-side; it is not a frozen-path concern). Patch binds `frozenPaths = [spec subtree]`, `blockerAppendAllowed = false`.
- Reaction stays at each call site: plan returns the existing validation error / blocker result; patch reverts via its existing checkout+clean. Rules out a shared module that also performs the reaction — plan errors, patch reverts; forcing one reaction changes behavior.
- The `## Blocker`-append vs full-rewrite discrimination (current `isValidIntentModification`, incl. frontmatter immutability) moves into the shared detector behind `blockerAppendAllowed`. Untracked-addition detection (patch relies on porcelain catching untracked spec files) is preserved.
- No observable behavior change: plan still errors on the same modifications and accepts blocker-only intent edits; patch still reverts the same spec edits including untracked additions.

## Task checklist

- Add `v1/src/modes/review/boundary.ts` with the parameterized porcelain detector and the blocker-append discrimination.
- Reimplement plan's `validateReviewOutput` on top of it (intent.md frozen, blocker-append allowed) and keep the `index.md`-exists assertion; remove the now-dead `isValidIntentModification` duplication.
- Reimplement patch's `detectSpecTreeEdits` on top of it (spec subtree frozen); keep `revertSpecTreeEdits` as the patch-side reaction calling the shared detector.
- Co-locate unit tests for the detector next to the module; keep/adjust existing plan and patch boundary tests.

## Acceptance criteria

- [ ] `v1/src/modes/review/boundary.ts` exists and exports a single porcelain-based detector parameterized by frozen paths and blocker-append allowance.
- [ ] Plan review boundary checking and patch spec-tree edit detection both call the shared detector; no duplicated porcelain-walk/path-filter remains in `plan/review.ts` or `patch/review.ts`.
- [ ] A test asserts the detector flags out-of-boundary edits, accepts a frozen file changed only by an appended `## Blocker` when `blockerAppendAllowed`, and rejects it when not.
- [ ] A test asserts patch detection still catches untracked spec-tree additions.
- [ ] Existing plan-review (intent.md immutable except blocker; index.md must exist) and patch-review (spec edits reverted including untracked) behavior is unchanged — covered by retained/adjusted tests.
- [ ] `bun run typecheck` and `bun test` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md`: note that plan-review intent-immutability and patch-review spec-tree freezing now share one detector (behavior unchanged); reconcile the existing plan-review and patch-review boundary entries if they imply separate logic.
- `v1/docs/run-loop.md` / `v1/docs/plan-mode.md`: if either describes the review write-boundary mechanism, note the shared detector while preserving the documented per-mode reaction (plan errors/blocks, patch reverts).
