# 00 - Prerequisites bullet block assembly

## Problem

`validPrerequisites` in `shared/intent-stage.ts` validates each non-empty raw line in `## Prerequisites` as a `-` bullet. Markdown continuation lines read as malformed second bullets, so wrapped prerequisites fail intent landing with `must list prerequisites as one bullet per line` even when the staged intent is valid.

## Decisions

- Assemble each `## Prerequisites` bullet from list-marker line plus continuation lines until the next `-` bullet or `##` heading before validating — rules out line-by-line raw checks and prompt-side anti-wrap guidance.
- Export a shared bullet-block assembly helper from `shared/spec-parser.ts` using the same continuation-until-next-bullet-or-`##` rule as `parseAcceptanceCriteria`, and call it from `validPrerequisites` — rules out a second private line-walker in `intent-stage.ts`.
- Validate each assembled block by its first line (`^- \S`); continuation lines inside the block are not re-checked as bullets — rules out requiring every physical line to start with `-`.
- Genuinely malformed prerequisites (non-bullet paragraph) still refuse with `must list prerequisites as one bullet per line`; empty `## Prerequisites` remains valid — rules out accepting prose or changing the error string.
- Out of scope: other landing contracts that read line-by-line — rules out auditing them in this slice.

## Prerequisites

- `validateIntentStage` / `validateIntentStageContent` refuse prerequisites prose with `must list prerequisites as one bullet per line` (`shared/intent-stage.ts`).
- `parseAcceptanceCriteria` assembles checklist items from marker line plus continuations until the next checklist item or `##` heading (`shared/spec-parser.ts`).

## Task checklist

- Add exported bullet-block assembly in `shared/spec-parser.ts`; refactor `parseAcceptanceCriteria` to use it without behavior change.
- Update `validPrerequisites` to assemble prerequisite bullets before validating first-line bullet shape.
- Add coverage in `shared/intent-stage.test.ts` for two-line wrap, multi-line wrap with mid-inline-code continuation, prose regression, and a mutation checkpoint on the two-line wrap pin.
- Update `v2/docs/v1-behaviors.md` prerequisite baseline wording.

## Acceptance criteria

- [ ] `shared/intent-stage.test.ts` — `accepts prerequisites bullet wrapped across two lines` stages an intent whose `## Prerequisites` holds one bullet wrapped across two lines and asserts `validateIntentStageContent` passes; it fails against the pre-fix per-line contract.
- [ ] `shared/intent-stage.test.ts` — `accepts prerequisites bullet wrapped across three or more lines` stages a bullet wrapped across three or more lines including a continuation that splits mid-inline-code and asserts validation passes; it fails against the pre-fix per-line contract.
- [ ] `shared/intent-stage.test.ts` — `rejects malformed frontmatter and prerequisite prose` (prerequisites prose case) still refuses with `must list prerequisites as one bullet per line`; a regression that accepts prose fails.
- [ ] `shared/intent-stage.test.ts` — `accepts prerequisites bullet wrapped across two lines`; Mutation checkpoint: `// @mutate` in that test reverts `validPrerequisites` block assembly to the pre-fix per-line `.split("\n").filter(...).every(...)` check and turns the pin red.
- [ ] `bun run typecheck`, `bun run test:v1`, and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md` — update the intent landing `## Prerequisites` baseline from one physical bullet line per prerequisite behavior to block-assembled bullets (marker line plus markdown continuation lines until the next bullet or `##` heading).
