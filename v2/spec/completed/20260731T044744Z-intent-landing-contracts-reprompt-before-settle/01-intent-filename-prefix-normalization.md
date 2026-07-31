# 01 - NN- filename prefix normalization

## Problem

Agents sometimes emit ready-intent filenames like `01-my-intent.md`. Landing rejects
them today; operators hand-rename under `.jarvis-intent-stage/` and resume. Ordering
prefixes are mechanical — the harness should normalize them, not reprompt or fail.

## Decisions

- Reorder `validateIntentStage` so `NN-` prefix stripping runs before
  `validateIntentFilenames` — committed code validates filenames first and rejects
  prefixed names today; normalization inside repair alone is insufficient.
- Prefix strip precedes `repairIntentFile` (content repair) — repair derives slug from
  basename; stripping after repair can corrupt `name:` alignment for prefixed filenames.
- Pipeline order: prefix normalize → content repair → filename validation → content
  validation — shared by write-loop pre-completion gate and `landIntentWorkflowOutput`.
- Strip a leading `\d+-` segment once; landed durable basename is the unprefixed slug —
  rules out rewriting frontmatter `name:` or body prose.
- Two staged files that normalize to the same basename (e.g. `01-foo.md` + `02-foo.md`)
  fail immediately via the existing duplicate-name check — not silent overwrite or reprompt.
- Out of scope: changing the no-ordering-prefix contract or prompt text (subspec 00).

## Prerequisites

- `landIntentWorkflowOutput` validates staged ready-intents via `validateIntentStage`
  (`v2/src/execution/intent-output.ts`, `shared/intent-stage.ts`).

## Task checklist

- Add `normalizeIntentStageFilenames` (or equivalent) that renames staged files matching
  `^\d+-(.+)\.md$` to `$1.md`.
- Wire it into `validateIntentStage` after rogue/directory checks and before
  `repairIntentFile` and `validateIntentFilenames`.
- Add unit coverage in `shared/intent-stage.test.ts` and landing coverage in
  `v2/src/execution/intent-output.test.ts`.

## Acceptance criteria

- [x] `shared/intent-stage.test.ts` `normalizes NN- ordering prefix on staged filename`
      stages `01-example.md` with valid `name: example` content, runs the stage pipeline,
      and asserts the stage holds `example.md` not `01-example.md`; it fails against the
      pre-fix code.
- [x] `shared/intent-stage.test.ts` `rejects duplicate basename after NN- prefix normalize`
      stages `01-foo.md` and `02-foo.md`, runs the stage pipeline, and asserts duplicate-name
      validation failure; it fails against the pre-fix code.
- [x] `intent-output.test.ts` `lands NN-prefixed staged filename under unprefixed durable name`
      stages `01-example.md`, calls `landIntentWorkflowOutput`, and asserts
      `ready-intents/example.md` exists with no reprompt surface exercised; it fails against
      the pre-fix code (which rejects the prefixed name).
- [x] Skipping the normalize-before-validate pipeline guard (run filename validation before
      prefix strip) turns `normalizes NN- ordering prefix on staged filename` RED; the pinning
      test names that mutation checkpoint.

## Documentation updates

- None — subspec 02 owns `write-behavior.md` landing-contract operator semantics.
