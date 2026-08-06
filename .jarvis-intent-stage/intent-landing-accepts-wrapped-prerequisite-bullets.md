---
name: intent-landing-accepts-wrapped-prerequisite-bullets
---

# Intent landing accepts wrapped prerequisite bullets

## Problem

Intent landing refuses a staged intent whose `## Prerequisites` bullet wraps across lines with `intent: <file>.md must list prerequisites as one bullet per line`. Valid Markdown continuation lines read as malformed second bullets because `validPrerequisites` checks raw lines. Agents wrap at house style; recovery today is hand-unwrapping `.jarvis-intent-stage/` and `jarvis run resume`.

Splitting does not apply: block assembly, `validPrerequisites`, landing tests, and operator-runbook recovery prose all sit on the execution-loop intent-landing surface.

## Decisions

- Assemble each `## Prerequisites` bullet from its full block (list-marker line plus continuation lines until the next `-` bullet or `##` heading) before validating — rules out asking agents or prompts to avoid wrapping.
- Reuse the bullet-block assembly helper from `spec-parser-human-only-block-match` (`shared/spec-parser.ts`) in `validPrerequisites` — rules out a second private line-walker.
- Genuinely malformed prerequisites (non-bullet paragraph, empty section still allowed) still refuse with the existing `must list prerequisites as one bullet per line` message — rules out relaxing the contract.
- Out of scope: other landing contracts that may read line-by-line — rules out auditing them in this slice.

## Acceptance criteria

- [ ] `intent-stage.test.ts` — a staged intent whose `## Prerequisites` holds one bullet wrapped across two lines passes `validateIntentStageContent`; fails against the current line-by-line contract.
- [ ] `intent-stage.test.ts` — a prerequisites bullet wrapped across three or more lines, including one wrapping mid-inline-code, passes validation.
- [ ] `intent-stage.test.ts` — `## Prerequisites` holding a non-bullet paragraph still refuses with `must list prerequisites as one bullet per line`; regression fails if prose is accepted.
- [ ] `intent-stage.test.ts` — `// @mutate` directive reverting block assembly in `validPrerequisites` to first-line-only turns the two-line wrapped-bullet test RED; criterion names that test title.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Intent finalization failed with staged files remaining — drop any hand-unwrap stopgap for wrapped prerequisite bullets once this ships.

## Prerequisites

- Intent-split landing validates staged ready-intent shape via `validateIntentStage` and reprompts or refuses prerequisites prose with `must list prerequisites as one bullet per line`.
- `parseAcceptanceCriteria` assembles each checklist item from list-marker line plus continuation lines until the next checklist item or `##` heading before human-only classification.
