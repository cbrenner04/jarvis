# 00 - Require approval gate after refine

## Goal

Add an opt-in refine-phase gate that intentionally stops a fresh committed plan run after the last refinement turn, leaving the existing blocker-driven intent-only draft PR open for human approval before draft begins.

## Decisions

- First cut is CLI-flag driven: `jarvis plan --require-intent-approval ...`.
- This first cut applies only to fresh committed plan runs (`modes.plan.commit: true`), matching the existing refine blocker PR lifecycle.
- When the flag is off, fresh plan runs keep the current direct refine-to-draft behavior unchanged.
- The approval gate is a refine-only stop condition. Draft and review keep their current blocker behavior.
- The final refine turn means the last configured refine pass that would otherwise hand off to draft.
- On that final turn, the agent should append a normal `## Blocker` section only when approval is required and the turn did not already append a genuine blocker.
- The blocker body should reflect the current intent. It may contain guided review questions, and it may contain a simple approval message when there are no open questions.
- Existing blocker semantics stay uniform. The harness does not distinguish "approval" blockers from other blockers in persisted content.

## Task Checklist

- Add CLI parsing and fresh-run plumbing for `--require-intent-approval`.
- Teach the refine loop when the current turn is the last configured refine turn before draft on a fresh committed run.
- Update the refine prompt or prompt inputs so the agent knows that this last turn must leave a review-gate blocker when approval is required, unless it already produced a genuine blocker on its own.
- Reuse the existing refine blocker exit path so refinement still produces `plan: refine`, then `plan: blocker`, pushes both, opens or updates the draft PR, and exits non-zero.
- Keep the intent file contract narrow: no new blocker metadata, marker types, or sidecar state.
- Update `docs/plan-mode.md` so operators can discover the new flag and understand why refinement may now stop before draft.

## Acceptance criteria

- [x] `jarvis plan --require-intent-approval <intent>` stops after refinement even when the intent is otherwise ready for draft, by appending `## Blocker` to `spec/<spec-dir>/intent.md` on the final refine turn.
- [x] The blocker body may contain zero guided questions; when there are no open questions it still leaves a clear approval message telling the reviewer that drafting can proceed after the blocker is cleared.
- [x] If the final refine turn already appends a genuine `## Blocker` because clarification is actually needed, jarvis reuses that blocker and stop path rather than appending a second approval-only blocker.
- [x] Fresh plan runs without `--require-intent-approval` keep the existing refine-to-draft behavior and do not synthesize a blocker solely for approval.
- [x] On committed runs, the stop reuses the current refine blocker mechanics end-to-end: `plan: refine` commits first, `plan: blocker` follows, the existing draft PR is opened or updated before exit, and no new blocker kind or metadata is introduced.
- [x] `docs/plan-mode.md` documents `--require-intent-approval` as a refine-phase checkpoint on fresh committed runs rather than as a general blocker feature.

## Documentation updates

- Document the new `--require-intent-approval` flag, the refine-phase approval checkpoint, and the intent-only PR state it produces in `docs/plan-mode.md`.
