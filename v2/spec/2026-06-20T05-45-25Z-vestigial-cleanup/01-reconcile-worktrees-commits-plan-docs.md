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

## Task checklist

- [ ] Replace the temporary-slot intent-refinement paragraph with the current behavior: the final plan name is known up front from the ready-intent, and the worktree is created directly at `plan-<plan-name>` / `plan/<plan-name>`.
- [ ] Remove `plan: intent`, `plan: refine`, and `plan: refine r<n>` from the phase-commit list, leaving the entries that are actually produced (draft, review, blocker, and their resume `r<n>` forms).

## Acceptance criteria

- [ ] `v1/docs/worktrees-and-commits.md` no longer references a `plan-tmp-<…>` / `plan/tmp-<…>` temporary slot or a rename to the final plan worktree.
- [ ] `v1/docs/worktrees-and-commits.md` no longer lists `plan: intent` or `plan: refine` (including `plan: refine r<n>`) as produced plan-mode commits.
- [ ] The section states the plan name is fixed up front from the ready-intent and the worktree is created directly at `plan-<plan-name>`, matching `v1/src/commands/plan.ts` and `v1/src/modes/plan/commits.ts`.
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v1/docs/worktrees-and-commits.md`: corrected plan intent/refine section (this is the sole deliverable).
