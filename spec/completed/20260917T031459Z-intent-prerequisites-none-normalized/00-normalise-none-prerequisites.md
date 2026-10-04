# Normalise `none` Prerequisites body at intent repair

## Problem

`validateIntentStageContent` in `shared/intent-stage.ts` refuses a ready-intent whose `## Prerequisites` body is `none` with `must list prerequisites as one bullet per line`.

## Decisions

- `repairIntentFile` (private, runs inside the exported `repairIntentStageContent` before validation and markdownlint autofix) rewrites a Prerequisites body that is a single `none`/`None.` line (case-insensitive, optional trailing period, ignoring surrounding whitespace) to an empty body — not a validator-side exemption — keeps landed intents uniform. It locates the body the same way `validPrerequisites` does: from the `## Prerequisites` heading to the next `##` heading or end of file.
- This overrides the intent's "section removed" framing: the heading stays with an empty body instead of being deleted, because `hasPrerequisites`/`validateIntentStageContent` refuse a missing heading and `repairIntentFile` unconditionally re-adds it when absent — an empty heading is already the landed "no prerequisites" form, so deleting it would just have it reappear.
- An empty Prerequisites body is already accepted by `validPrerequisites` today; this subspec adds no new handling for it.

## Acceptance criteria

- [x] A test in `shared/intent-stage.test.ts` drives the exported `repairIntentStageContent` (with an injected lint runner) on a staged ready-intent whose Prerequisites body is `none` (and separately `None.`), and asserts the repaired file has an empty Prerequisites body with no extra blank lines, passes the injected markdownlint run, and passes `validateIntentStageContent`; it fails against the pre-fix refusal.
- [x] A test in `shared/intent-stage.test.ts` proves a prose (non-`none`) Prerequisites body still returns the one-bullet-per-line refusal from `validateIntentStageContent`.
- [x] `bun run typecheck`, `bun run test:v2`, `bun run test:integration:v2`, `bun run test:shared`, and `bun run test:integration:shared` pass.

## Documentation updates

- `v2/docs/spec-guidance.md` — ready-intent Prerequisites: leave empty or write `none` for independent intents; landing normalises `none` to an empty body.
- `v2/docs/v1-behaviors.md` — update the existing Prerequisites-refusal entry to note `none`/`None.` bodies are normalised to empty instead of refused.
