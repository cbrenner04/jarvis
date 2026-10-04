---
name: intent-landing-accepts-wrapped-prerequisite-bullets
---

# Intent landing accepts wrapped prerequisite bullets

## Problem

Intent landing refuses a staged intent whose `## Prerequisites` bullet wraps across lines with `intent: <file>.md must list prerequisites as one bullet per line`. Valid Markdown continuation lines read as malformed second bullets because `validPrerequisites` checks raw lines. Agents wrap at house style; recovery today is hand-unwrapping `.jarvis-intent-stage/` and `jarvis run resume`.

Splitting does not apply: block assembly, `validPrerequisites`, and landing tests all sit on the execution-loop intent-landing surface.

## Decisions

- Assemble each `## Prerequisites` bullet from its full block (list-marker line plus continuation lines until the next `-` bullet or `##` heading) before validating — rules out asking agents or prompts to avoid wrapping.
- Extract a shared bullet-block assembly helper in `shared/spec-parser.ts` (same continuation-until-next-bullet-or-`##` rule as private `parseAcceptanceCriteria`) and use it in `validPrerequisites` — rules out a second private line-walker.
- Genuinely malformed prerequisites (non-bullet paragraph, empty section still allowed) still refuse with the existing `must list prerequisites as one bullet per line` message — rules out relaxing the contract.
- Out of scope: other landing contracts that may read line-by-line — rules out auditing them in this slice.

## Acceptance criteria

- [ ] `intent-stage.test.ts` — a staged intent whose `## Prerequisites` holds one bullet wrapped across two lines passes `validateIntentStageContent`; fails against the current line-by-line contract.
- [ ] `intent-stage.test.ts` — a prerequisites bullet wrapped across three or more lines, including one wrapping mid-inline-code, passes validation.
- [ ] `intent-stage.test.ts` — `## Prerequisites` holding a non-bullet paragraph still refuses with `must list prerequisites as one bullet per line`; regression fails if prose is accepted.
- [ ] `intent-stage.test.ts` — `accepts prerequisites bullet wrapped across two lines` goes RED when `// @mutate` in that test reverts `validPrerequisites` block assembly to first-line-only.
- [ ] `bun run typecheck`, `bun run test:v1`, and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md` — landing prerequisite validation accepts markdown continuation lines within a bullet; update the "one bullet line per prerequisite behavior" baseline to block-assembled bullets.

## Prerequisites

- Intent-split landing validates staged ready-intent shape via `validateIntentStage` and reprompts or refuses prerequisites prose with `must list prerequisites as one bullet per line`.
- `parseAcceptanceCriteria` assembles each checklist item from list-marker line plus continuation lines until the next checklist item or `##` heading before human-only classification.
