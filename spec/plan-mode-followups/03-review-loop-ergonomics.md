# 03 — Review-loop ergonomics and resumability

## Problem

Several review notes (**#8**, **#19**, **#21**, **#29**, **#48**, **#49**)
flagged usability rough edges in the self-review loop:

- The pass counter is logged but the user can't see what changed
  between passes without inspecting commits.
- A review pass that produces no diff still creates a commit (empty
  commit guarded only by `hasWorkingTreeChanges`, which works, but the
  banner says "review N" without distinguishing "did real work" from
  "did nothing").
- There is no `--review-passes 0` smoke test.
- The review prompt's reference to "the previous pass" is vague when N
  is the first pass.
- Resume semantics for review passes are undefined: re-running plan
  mode against an existing worktree that already has `plan: review 1`
  but not `plan: review 2` is currently rejected by the
  worktree-collision check, so the deferred-resume question (**#48**,
  **#49**) is moot for now but should be documented as such.

## Decisions

- **Skip empty review passes silently.** When `hasWorkingTreeChanges`
  returns false after a review pass, do not create a commit and do not
  increment the user-visible pass counter — log instead
  `plan mode: review pass <N> made no changes; skipping commit` and
  proceed to the next pass. The internal counter still advances so
  that `--review-passes 2` always runs at most two agent invocations.
- **Distinguish "first review" in the prompt.** The review prompt
  template currently says "previous pass." Replace with a conditional
  paragraph: when N=1, the prompt says "this is the first review
  pass; the spec snapshot below is the original draft." When N>1,
  it says "this is review pass N of M; the spec snapshot below
  reflects the prior pass."
- **Add a `--review-passes 0` regression test.** A new test in
  `test/plan-command.test.ts` (or a sibling) verifies that with
  `--review-passes 0`, the harness commits `plan: draft`, opens the
  PR, and exits 0 without invoking the review agent at all.
- **Document resume as out-of-scope.** Add a one-paragraph note in
  `docs/plan-mode.md` saying that resuming a partially-reviewed
  worktree is handled by `spec/plan-mode-resume-and-handoff/` and is
  not supported by today's harness; the worktree-collision check
  applies.

## Acceptance criteria

- [ ] Empty review passes log the skip message and do not create a
  commit; a test asserts no `plan: review` commit is created when the
  agent makes no changes.
- [ ] The review prompt template emits different wording for N=1 vs
  N>1; a unit test on `buildReviewPrompt` covers both branches.
- [ ] A `--review-passes 0` test covers the no-review path.
- [ ] `docs/plan-mode.md` has a "Resume" subsection that points at
  `spec/plan-mode-resume-and-handoff/` and states the current
  no-resume behavior.
- [ ] `bun run typecheck`, `bun test`, and `bun run check` all pass.

## Documentation updates

- See acceptance criteria above for `docs/plan-mode.md`.
- No changes to `README.md`, `AGENTS.md`, or `docs/spec-guidance.md`.
