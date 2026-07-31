# 00 - Intent write-step landing contract prompts

## Problem

Intent split agents can violate landing shape contracts (prerequisites formatting,
ordering-prefixed filenames) that `validateIntentStage` enforces only at
`landPublication` time — after the write agent has finished. Operators recover by
hand-editing `.jarvis-intent-stage/` and resuming. The harness must state
enforceable contracts in the injected write-step prompt so agents can fix them
during the write loop.

## Decisions

- Pin emitted-filename and prerequisites contracts in `buildIntentSplitPrompt`'s
  `## File output` block (same surface as today's one-bullet-per-line rule) — rules
  out a separate prompt artifact or recovery-only doc change.
- Filename contract: `<name>.md` only; no `NN-` ordering prefix — rules out
  leaving prefix prohibition implicit in landing validation alone.
- Prerequisites contract: one `- ...` bullet per physical line when non-empty; empty
  body when none — rules out changing the underlying contract (intent out of scope).
- Prerequisites one-bullet-per-line is already pinned in committed prompt tests — rules
  out a false pre-fix failure claim; this slice adds only the filename contract pin.
- Pin via `shared/prompts/intent-split.test.ts` substring guards — rules out
  duplicating assertions only in `write.test.ts`.

## Prerequisites

- Intent write-step rules are injected from rendered prompts with existing prompt tests
  (`buildIntentSplitPrompt`, `shared/prompts/intent-split.test.ts`, `write.test.ts`).

## Task checklist

- Extend `buildIntentSplitPrompt` `## File output` with explicit no-ordering-prefix
  filename rule alongside the existing prerequisites bullet rule.
- Add pinned substring test for the filename contract in `shared/prompts/intent-split.test.ts`.

## Acceptance criteria

- [ ] `shared/prompts/intent-split.test.ts` `intent split prompt states landing filename contract`
      asserts `buildIntentSplitPrompt` output requires `<name>.md` with no `NN-` ordering
      prefix; it fails against the pre-fix prompt.
- [ ] `shared/prompts/intent-split.test.ts` `includes governed layering, file output, and optional step rules`
      stays green (existing coverage pins prerequisites one-bullet-per-line).

## Documentation updates

- None — durable landing reprompt/normalization behavior lands in subspec 02
  (`write-behavior.md`); this slice is prompt-only.
