# 00 - subtractive review mandate

## Problem

Every plan phase grows the spec and none shrinks it. `plan.prompt.review` tells
the agent to "rewrite the files in place to address the most important issues" and
"rewrite the most important issues now" — additive framing. Across multiple review
passes a spec can only accrete. Review is the only phase positioned to compress
(refine appends to intent; draft is first creation), but it is never told to.

The decisions-ledger fragment set the *shape* of authored content; it did not give
review a *direction*. This spec makes a review pass subtractive by default: the
brake on length that mirrors `plan.defer-to-consumer`'s brake on invented
precision.

The one hazard: the ledger fragment says entry count is uncapped and thoroughness
is the goal. Subtractive review must cut prose, never decisions — the two rules
agree (prose is the enemy, decisions are sacred), and the mandate must say so
explicitly so review does not strip decisions to look smaller.

## Decisions

- Edit the `plan.prompt.review` step prompt body (`prompts/plan/review.md`); do
  not add a fragment. Subtractive behavior has exactly one consumer (review) —
  draft creates and refine appends — so a cross-phase fragment would be misplaced.
- Reframe the review mandate from additive to subtractive. The body must state:
  - A review pass is a compressor, not an expander; prefer cutting over adding.
  - Do not grow the spec across a pass unless you are adding a genuinely missing
    decision, acceptance criterion, or required doc update.
  - Cut narrative paragraphs, restated context, and redundant rationale — anything
    that is not a decision, a criterion, or a required doc update (consistent with
    the decisions-ledger shape).
  - Cut prose, never decisions. Removing a real decision to shrink the spec is a
    failure; the entry count stays uncapped.
  - Removing content is a valid, expected review outcome; a pass that only adds is
    suspect.
- Keep the change directional, not numeric: "do not grow / prefer cutting," no
  length cap or target number. A cap becomes an inflation target; "non-increasing
  unless adding a missing decision" has no value to shoot for.
- Editing `review.md` changes only the rendered review prompt. Bump
  `plan.prompt.review` revision (relative to whatever is on `main` at
  implementation time; currently `4`) and regenerate its rendered fixtures,
  including the per-pass review variants. `plan.prompt.draft` and
  `plan.prompt.refine` are untouched and their revisions do not change.
- No change to `--review-passes` defaults, the review section/heading contracts,
  the intent-write boundary, or the existing blocker handling.

## Non-goals

- No numeric length cap or target anywhere.
- No new shared fragment; no patch-mode change.
- No change to draft or refine prompts.
- No change to review-pass count, budgets, or the interactive/non-interactive
  boundary.

## Tasks

- [ ] Edit `prompts/plan/review.md` so the mandate is subtractive per the
  decisions above (intro line, the `## Current Spec Files` instruction, and the
  `## Instructions` footer all currently use additive "address the most important
  issues" framing — align them).
- [ ] Bump `plan.prompt.review` revision; regenerate the rendered-prompt fixtures
  under `v1/test/fixtures/prompts/rendered/` for review, including per-pass
  variants.
- [ ] Update the `plan.prompt.review` revision assertion in
  `v1/test/prompts/rendered-snapshots.test.ts`.
- [ ] Run `bun run typecheck` and `bun test`.

## Acceptance criteria

- [ ] `prompts/plan/review.md` instructs that a review pass prefers cutting and
  does not grow the spec except to add a missing decision/criterion/doc.
- [ ] The review prompt states cut prose, never decisions (entry count stays
  uncapped).
- [ ] The review prompt contains no numeric length cap or target.
- [ ] `plan.prompt.draft` and `plan.prompt.refine` bodies and revisions are
  unchanged.
- [ ] Rendered-prompt snapshot tests pass against regenerated, revision-keyed
  review fixtures (all pass variants).
- [ ] `bun run typecheck` and `bun test` pass.

## Documentation updates

- Note the subtractive review mandate where plan-phase behavior is described
  (`v1/docs/plan-mode.md`; and `v1/docs/prompt-governance.md` if it characterizes
  review behavior). No new standalone doc.
