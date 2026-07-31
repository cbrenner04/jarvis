# 01 - NN- filename prefix normalization

## Problem

Agents sometimes emit ready-intent filenames like `01-my-intent.md`. Landing rejects
them today; operators hand-rename under `.jarvis-intent-stage/` and resume. Ordering
prefixes are mechanical — the harness should normalize them, not reprompt or fail.

## Decisions

- Normalize `NN-` ordering prefixes on staged `.md` filenames in
  `repairIntentStageContent` before filename validation — rules out reprompting or
  settling `landing_failed` for prefix-only violations.
- Strip a leading `\d+-` segment once; landed durable basename is the unprefixed
  slug — rules out rewriting frontmatter `name:` or body prose.
- Normalization runs on the same repair pass as existing intent-stage repairs
  (`shared/intent-stage.ts`) so write-loop pre-completion validation and
  `landIntentWorkflowOutput` share one path — rules out a write-loop-only rename.
- Out of scope: changing the no-ordering-prefix contract or prompt text (subspec 00).

## Prerequisites

- `landIntentWorkflowOutput` validates staged ready-intents via `validateIntentStage`
  (`v2/src/execution/intent-output.ts`, `shared/intent-stage.ts`).

## Task checklist

- Rename staged files whose basename matches `^\d+-(.+)\.md$` to `$1.md` during
  intent-stage repair (before `validateIntentFilenames`).
- Add unit coverage in `shared/intent-stage.test.ts` and landing coverage in
  `v2/src/execution/intent-output.test.ts`.

## Acceptance criteria

- [ ] `shared/intent-stage.test.ts` `normalizes NN- ordering prefix on staged filename`
      stages `01-example.md` with valid `name: example` content, runs repair, and asserts
      the stage holds `example.md` not `01-example.md`; it fails against the pre-fix code.
- [ ] `intent-output.test.ts` `lands NN-prefixed staged filename under unprefixed durable name`
      stages `01-example.md`, calls `landIntentWorkflowOutput`, and asserts
      `ready-intents/example.md` exists with no reprompt surface exercised; it fails against
      the pre-fix code (which rejects the prefixed name).
- [ ] Inverting the rename guard in `shared/intent-stage.ts` (skip or no-op the prefix strip)
      turns `normalizes NN- ordering prefix on staged filename` RED; the pinning test names
      that mutation checkpoint.

## Documentation updates

- None — subspec 02 owns `write-behavior.md` landing-contract operator semantics.
