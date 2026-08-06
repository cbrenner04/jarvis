---
name: plan-intent-write-steps-lint-own-markdown
---

# Plan and intent write steps finalize Markdown they never linted

Split from `plan-output-fails-lint-md-and-repair-edits-unrelated-source` (2026-08-04): this seed owns the write-step self-lint; the repair misbehavior those runs also exhibited is owned by `gate-repair-fence`.

## Problem

The plan write step drafts Markdown and finalizes without ever linting it. `lint:md` then runs in the ready gate and goes red on the spec the run just wrote — the gate is the first thing that reads the plan's own output. Two plan runs on 2026-08-03, same session: `f225849b` → `5fd45995` (`tui-command-editor` 00, `MD012` × 1) and `77b741af` → `080e3d64` (`tui-command-dispatch` 02, `MD038` × 4). Both entered gate repair, both settled `completion_commit_failed`, both cost a hand-finish. The intent write step drafts Markdown on the identical seam.

## Decisions

- The plan write step lints its own staged Markdown before finalization and reprompts on failure
  with the rule and location — rules out the ready gate being the first reader of the plan's
  Markdown. The intent write step enforces the same contract.
- A clean draft finalizes with no extra invocation — the check adds no cost to the passing path.
- Out of scope: gate-repair behavior on lint failures that still reach the gate
  (`gate-repair-fence`), and the `lint:md` rule set itself.

## Acceptance criteria

- [ ] A plan write step whose staged Markdown violates a configured `lint:md` rule reprompts with
      the rule and location instead of finalizing; a regression fails against the baseline, which
      finalizes unconditionally.
- [ ] A plan write step whose staged Markdown is clean finalizes with no extra invocation.
- [ ] The intent write step enforces the same contract on its staged Markdown.
- [ ] Replaying the two recorded failures (a spec with `MD012` multiple-blanks, and one with
      `MD038` spaces-in-code-span) reaches a green gate without a repair iteration.
- [ ] Mutation checkpoint: a `// @mutate` directive removing the staged-Markdown lint gate turns the
      reprompt regression RED.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — plan and intent write steps lint their staged Markdown before
  finalization.

## Prerequisites

- Plan and intent write steps stage Markdown before a finalization/landing boundary
  (`v2/src/execution/plan-workflow-steps.ts`, `intent-workflow-steps.ts`)
