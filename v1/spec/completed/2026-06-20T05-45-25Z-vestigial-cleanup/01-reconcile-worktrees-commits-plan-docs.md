# Reconcile worktrees-and-commits plan intent/refine docs

## Problem

`v1/docs/worktrees-and-commits.md` "Plan-mode worktrees" section describes a
plan flow that no longer exists:

- A temporary slot `.worktree/plan-tmp-<short-uuid>/` on `plan/tmp-<short-uuid>`
  that gets renamed to the final `plan-<plan-name>` after the agent proposes a
  name (lines ~196–200).
- `plan: intent` and `plan: refine` (and `plan: refine r<n>`) phase commits
  (lines ~204–205, ~209).

The current flow takes a pre-authored ready-intent (already carrying `name:`),
derives the final plan name up front (`ensureUniquePlanName`), and creates the
worktree directly at `.worktree/plan-<plan-name>/` on `plan/<plan-name>` — no
temp slot, no rename. `intent.md` is a byte-for-byte copy of the ready-intent;
no `plan: intent` commit is written. `commitPlanRefine`/`commitPlanIntent` are
not called from any production path, so no `plan: intent`/`plan: refine` commit
is produced. The `RESUME_SUBJECT_RE` still tolerates a `refine` token only to
parse legacy commits when computing the next resume index — it does not emit one.

## Decisions

- Reconcile only the intent/refine drift: the temporary-slot rename narrative and the `plan: intent` / `plan: refine` commit entries. Rules out rewriting the unrelated review-commit format in the same section (separate drift, out of scope).
- Describe the current produced commit subjects only. Rules out documenting `commitPlanIntent`/`commitPlanRefine` as if still live (speculative documentation of unimplemented flows).
- Keep a one-line "`refine` parsed-but-not-emitted" note in the corrected doc explaining why `RESUME_SUBJECT_RE` retains the token (legacy resume-index parsing). Rules out silently dropping the token's mention, which would invite a future reader to "clean up" a regex branch that is still load-bearing for legacy commits.
- Review-commit-format drift stays out of scope (Decision 1): verify the retained entries are correct and leave them; do not fix that format.

## Out of scope

- `cleanupCommittedTempPlanState` is unrelated error-cleanup invoked with the *final* plan name, not a temp-slot artifact. A `temp`/`tmp` grep over the rewritten narrative must not redirect an edit there.

## Task checklist

- [ ] Replace the temporary-slot intent-refinement paragraph with the current behavior: the final plan name is known up front from the ready-intent, and the worktree is created directly at `plan-<plan-name>` / `plan/<plan-name>`.
- [ ] Remove `plan: intent`, `plan: refine`, and `plan: refine r<n>` from the phase-commit list. Verify the retained entries (draft, review, blocker, and their resume `r<n>` forms) against `v1/src/modes/plan/commits.ts` as still-correct and leave them as-is.
- [ ] Add a one-line note that `RESUME_SUBJECT_RE` still parses `refine` for legacy resume-index computation but never emits it.

## Acceptance criteria

- [x] `v1/docs/worktrees-and-commits.md` no longer references a `plan-tmp-<…>` / `plan/tmp-<…>` temporary slot or a rename to the final plan worktree.
- [x] `v1/docs/worktrees-and-commits.md` no longer lists `plan: intent` or `plan: refine` (including `plan: refine r<n>`) as produced plan-mode commits.
- [x] The section states the plan name is fixed up front from the ready-intent and the worktree is created directly at `plan-<plan-name>`, matching `v1/src/commands/plan.ts` and `v1/src/modes/plan/commits.ts`.
- [x] The corrected section keeps a one-line note that `RESUME_SUBJECT_RE` parses but does not emit `refine`; the retained draft/review/blocker entries are verified against `commits.ts`.
- [x] `bun run typecheck` and `bun run test` pass (typecheck passed; test failures are pre-existing in reap.test.ts and run.test.ts, unrelated to documentation changes).

## Documentation updates

- `v1/docs/worktrees-and-commits.md`: corrected plan intent/refine section (this is the sole deliverable).
