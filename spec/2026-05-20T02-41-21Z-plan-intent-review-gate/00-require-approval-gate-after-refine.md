# 00 - Require approval gate after refine

## Goal

Add an opt-in plan-mode path that stops after refinement with an intent-only draft PR so a human can review and approve the refined intent before drafting begins.

## Decisions

- First cut is CLI-flag driven: `jarvis plan --require-intent-approval ...`.
- When the flag is off, fresh plan runs keep the current direct refine-to-draft behavior unchanged.
- The approval gate is a refine-only stop condition. Draft and review keep their current blocker behavior.
- The final refine turn should append a normal `## Blocker` section when approval is required and no genuine blocker already exists.
- The blocker body should reflect the current intent. It may contain guided review questions, and it may contain a simple approval message when there are no open questions.
- Existing blocker semantics stay uniform. The harness does not distinguish "approval" blockers from other blockers in persisted content.

## Task Checklist

- Add CLI parsing and invocation plumbing for `--require-intent-approval`.
- Teach the refine flow when it is on the final refine turn with approval required.
- Update the refine prompt/instructions so the agent appends a review-gate blocker at that point unless it has already raised a genuine blocker.
- Reuse the existing blocker exit path so refine still produces `plan: refine`, then `plan: blocker`, pushes both, opens or updates the draft PR, and exits non-zero.
- Keep the intent file contract narrow: no new blocker metadata, marker types, or sidecar state.

## Acceptance criteria

- [ ] `jarvis plan --require-intent-approval <intent>` stops after refinement even when the intent is otherwise ready for draft, by appending `## Blocker` to `spec/<spec-dir>/intent.md` on the final refine turn.
- [ ] The blocker body may contain zero guided questions; when there are no open questions it still leaves a clear approval message telling the reviewer that drafting can proceed after the blocker is cleared.
- [ ] Fresh plan runs without `--require-intent-approval` keep the existing refine-to-draft behavior and do not synthesize a blocker solely for approval.
- [ ] The stop reuses the current refine blocker mechanics: `plan: refine` commit first, then `plan: blocker`, existing PR behavior preserved, and no new blocker kind or metadata is introduced.

## Documentation updates

- Document the new `--require-intent-approval` flag and the refine-phase approval checkpoint in `docs/plan-mode.md`.
