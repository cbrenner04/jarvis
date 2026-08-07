# 00 - Prerequisites bullet block assembly

## Problem

`validPrerequisites` in `shared/intent-stage.ts` validates each non-empty raw line in `## Prerequisites` as a `-` bullet. Markdown continuation lines read as malformed second bullets, so wrapped prerequisites fail intent landing with `must list prerequisites as one bullet per line` even when the staged intent is valid.

## Decisions

- Assemble each `## Prerequisites` bullet from list-marker line plus continuation lines until the next `-` bullet or `##` heading before validating — rules out line-by-line raw checks; does not change prompt authoring guidance in this slice.
- Export a shared bullet-block assembly helper from `shared/spec-parser.ts` with the same walker shape as `parseAcceptanceCriteria` (marker line plus continuations until next bullet or `##`) but parameterized by an explicit bullet-start predicate; document that continuation lines are trimmed with `.trim()` when appended (matching acceptance-criteria assembly). Checkbox (`- [ ]`) and plain `-` (dash-space) markers use different predicates — rules out claiming equivalence or a second private line-walker in `intent-stage.ts`.
- Only a dash-space marker at line start with no leading whitespace begins a new prerequisite block; an indented dash-space marker, alternate list markers, and other non-marker lines are continuation text inside the current block. Blank lines inside a block are included like acceptance-criteria assembly.
- Validate each assembled block by its first line (`^- \S`); continuation lines inside the block are not re-checked as bullets — rules out requiring every physical line to start with `-`.
- Genuinely malformed prerequisites (non-bullet paragraph) still refuse with `must list prerequisites as one bullet per line`; empty `## Prerequisites` remains valid — rules out accepting prose or changing the error string.
- Out of scope: other landing contracts that read line-by-line — rules out auditing them in this slice.

## Prerequisites

- `validateIntentStage` / `validateIntentStageContent` refuse prerequisites prose with `must list prerequisites as one bullet per line` (`shared/intent-stage.ts`).
- `parseAcceptanceCriteria` assembles checklist items from marker line plus continuations until the next checklist item or `##` heading (`shared/spec-parser.ts`).

## Task checklist

- Add exported parameterized bullet-block assembly in `shared/spec-parser.ts` (bullet-start predicate, continuation `.trim()` policy); refactor `parseAcceptanceCriteria` to call it with the checkbox predicate.
- Update `validPrerequisites` to assemble prerequisite bullets via the helper with a plain dash-space (`^- \S`) predicate before validating first-line bullet shape.
- Add `accepts prerequisites bullet wrapped across two lines` in `shared/intent-stage.test.ts` with a one-line `// @mutate` on a stable post-refactor anchor in `validPrerequisites` (e.g. the assembler call) that neuters block assembly and turns the pin red.
- Add `accepts prerequisites bullet wrapped across three or more lines` using this fixture (backtick span split across the marker and continuation lines): `- prerequisite uses \`shared/spec-\nparser.ts\` helper\n  and a third continuation line`.
- Extend `rejects malformed frontmatter and prerequisite prose` prerequisites-prose case to assert failure includes `must list prerequisites as one bullet per line`.
- Update `v2/docs/v1-behaviors.md` prerequisite baseline wording and add a short v2 landing cross-reference that prerequisite validation accepts markdown continuations within a block-assembled bullet; note the legacy error string still says "one bullet per line" while behavior accepts logical bullets.

## Acceptance criteria

- [x] `shared/intent-stage.test.ts` — `accepts prerequisites bullet wrapped across two lines` stages an intent whose `## Prerequisites` holds one bullet wrapped across two lines and asserts `validateIntentStageContent` passes; it fails against the pre-fix per-line contract.
- [x] `shared/intent-stage.test.ts` — `accepts prerequisites bullet wrapped across three or more lines` stages `- prerequisite uses \`shared/spec-\nparser.ts\` helper\n  and a third continuation line` and asserts validation passes; it fails against the pre-fix per-line contract.
- [x] `shared/intent-stage.test.ts` — `rejects malformed frontmatter and prerequisite prose` prerequisites-prose case refuses with error containing `must list prerequisites as one bullet per line`; a regression that accepts prose fails.
- [x] `shared/intent-stage.test.ts` — `accepts prerequisites bullet wrapped across two lines`; Mutation checkpoint: `// @mutate` in that test neuters block assembly at a stable post-refactor anchor in `validPrerequisites` and turns the pin red.
- [x] `shared/spec-parser.test.ts` — `classifies human-only markers anywhere in the criterion bullet block` stays green (behavior-preserving `parseAcceptanceCriteria` extraction).
- [x] `bun run typecheck`, `bun run test:v1`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md` — update the intent landing `## Prerequisites` baseline from one physical bullet line per prerequisite behavior to block-assembled bullets (marker line plus markdown continuation lines until the next bullet or `##` heading); add a v2 landing cross-reference for continuation acceptance and note the legacy error string wording.
