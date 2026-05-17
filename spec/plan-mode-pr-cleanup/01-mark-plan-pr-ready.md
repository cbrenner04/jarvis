# Mark plan-mode PR ready for review on completion

## Problem

Plan-mode PRs are opened as drafts by `ensureDraftPr` (`src/pr.ts`) and never
get marked ready for review — the comment in `buildPlanPrHeader`
(`src/modes/plan/pr.ts:99`) even codifies this ("Plan mode never marks this
PR ready for review"). The intent of plan mode is to produce a reviewable
spec tree; leaving the PR in draft forever means humans have to remember to
click "Ready for review" before the spec can land.

Patch mode already solves the analogous problem with `maybeMarkReady` in
`src/modes/patch/pr.ts`, which calls `gh pr ready <branch>` once the
linked subspecs are all complete. Plan mode should grow an equivalent
behavior, gated on a plan-mode notion of "complete."

## Decisions to make during implementation

- **What "complete" means for plan mode.** Plan mode runs an interview phase,
  a draft phase, and one or more review passes. The natural completion point
  is: the final review pass finished cleanly (no blocker appended to
  `intent.md`, working tree clean, draft validated). Confirm this against
  the flow in `src/commands/plan.ts` and the existing `commitPlanBlocker`
  path — if a blocker was raised, the PR must stay draft.
- **Where to call the new helper.** Likely at the end of the
  `runPlanCommand` happy path in `src/commands/plan.ts`, after the last
  `updatePrBody` call, only when no blocker is present. Follow the
  warn-and-continue pattern used for `updatePrBody` so a `gh` failure does
  not crash the run.
- **Resume runs.** `jarvis plan --resume` reuses the existing branch and PR,
  so the helper will sometimes run against a PR that is already in the
  non-draft "Open" state. `gh pr ready` against an already-ready PR exits
  non-zero; the warn-and-continue wrapper from the previous bullet absorbs
  that, so no separate idempotency handling is needed.

## Scope

- Add a `maybeMarkPlanPrReady` helper (name negotiable) in
  `src/modes/plan/pr.ts` that wraps `gh pr ready <branch>`, modeled on
  `maybeMarkReady` in `src/modes/patch/pr.ts`. It should accept the branch
  name and cwd, look up the PR via `checkPrExists`, and skip silently if no
  PR exists.
- Invoke the helper from the plan command happy path in
  `src/commands/plan.ts` once plan mode has finished without raising a
  blocker. Wrap the call in the same warn-and-continue pattern used for
  `updatePrBody` (see `src/commands/plan.ts` around line 1520+).
- If any code comment or string literal in `src/modes/plan/pr.ts` still
  asserts "Plan mode never marks this PR ready for review" after
  `[[00-simplify-plan-pr-body]]` lands, delete it. Skip if no occurrence
  remains.
- Add tests for the helper (PR exists → calls `gh pr ready`; no PR → no-op;
  `gh` failure → does not throw) and for the integration point (blocker
  present → not marked ready; happy path → marked ready). Follow the
  existing test-seam style used by `maybeMarkReady` and the plan-mode test
  suite.

## Out of scope

- Restructuring the plan command flow.
- Changing patch-mode behavior.
- Changing the PR body content itself (see `[[00-simplify-plan-pr-body]]`).

## Acceptance criteria

- [x] A new helper in `src/modes/plan/pr.ts` marks the plan-mode PR ready
      for review by invoking `gh pr ready <branch>`, no-ops when no PR
      exists, and does not throw on `gh` failure.
- [x] On a successful `jarvis plan` run (no blocker appended to
      `intent.md`), the plan PR ends in the non-draft "Open" state.
- [x] When plan mode appends a `## Blocker` to `intent.md`, the PR is
      left in draft state.
- [x] `jarvis plan --resume` against an already-ready PR completes without
      error.
- [x] Tests cover: helper PR-exists path, helper no-PR path, helper
      `gh`-failure path, integration happy path (ready), and integration
      blocker path (still draft).

## Documentation

- Update any AGENTS.md / docs that describe plan-mode PR lifecycle to
  reflect that the PR is now auto-marked ready on successful completion.
