---
name: plan-intent-write-steps-lint-own-markdown
---

# Plan and intent write steps lint staged Markdown before finalization

The fix touches one module-boundary surface (execution loop), so splitting does not apply: plan and intent write steps share the same pre-finalization staging seam in the write loop.

## Problem

The plan write step drafts Markdown and finalizes without ever linting it. `lint:md` then runs in the ready gate and goes red on the spec the run just wrote — the gate is the first thing that reads the plan's own output. Two plan runs on 2026-08-03, same session: `f225849b` → `5fd45995` (`tui-command-editor` 00, `MD012` × 1) and `77b741af` → `080e3d64` (`tui-command-dispatch` 02, `MD038` × 4). Both entered gate repair, both settled `completion_commit_failed`, both cost a hand-finish. The intent write step drafts Markdown on the identical seam.

## Decisions

- Plan write step lints staged Markdown before finalization and reprompts on failure with rule and location — rules out the ready gate being the first reader of plan Markdown.
- Intent write step enforces the same contract on `.jarvis-intent-stage/` output — rules out plan-only or intent-only coverage.
- Clean staged Markdown finalizes with no extra agent invocation — rules out a second lint-only pass after a passing draft.
- Reprompt carries configured `lint:md` rule id and file location — rules out a generic contract-miss without actionable lint coordinates.
- Out of scope: gate-repair on lint failures that still reach the ready gate (`gate-repair-fence`) and changes to the `lint:md` rule set.

## Acceptance criteria

- [ ] A plan write step whose staged Markdown violates a configured `lint:md` rule reprompts with the rule and location instead of finalizing; a regression fails against the baseline, which finalizes unconditionally.
- [ ] A plan write step whose staged Markdown is clean finalizes with no extra invocation.
- [ ] The intent write step enforces the same contract on its staged Markdown.
- [ ] Replaying the two recorded failures (a spec with `MD012` multiple-blanks, and one with `MD038` spaces-in-code-span) reaches a green gate without a repair iteration.
- [ ] Mutation checkpoint: a `// @mutate` directive removing the staged-Markdown lint gate turns the reprompt regression RED.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — plan and intent write steps lint their staged Markdown before finalization.

## Prerequisites

- Plan and intent write steps stage Markdown under `.jarvis-plan-stage/` and `.jarvis-intent-stage/` respectively before finalization or landing.
- `bun run lint:md` runs markdownlint against paths governed by `.markdownlint-cli2.jsonc`.
- The write loop reprompts the agent within `maxIterations` on pre-finalization validation failures (e.g. intent landing-contract violations).
