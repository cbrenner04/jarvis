---
name: intent-prerequisites-none-normalized
---

# Intent landing normalises an empty or `none` Prerequisites section

Surface: intent-stage validation/normalisation (`shared/intent-stage.ts`).

## Problem

`validateIntentStageContent` refuses `must list prerequisites as one bullet per line` when a ready-intent's `## Prerequisites` body is `none`, which split drafts write for independent intents (pipeline `d1fac88a`, landed by hand as #3911).

## Decisions

- A `## Prerequisites` body that is empty or a single `none`/`None.` line (case-insensitive, optional trailing period) means no prerequisites; landing drops the section before validation and staged markdown lint, leaving no extra blank lines.
- Any other prose body still refuses with the existing error.

## Acceptance criteria

- [ ] A test proves a ready-intent whose `## Prerequisites` body is `none` lands with the section removed and passes staged markdown lint; it fails against the pre-fix refusal.
- [ ] A test proves a prose (non-`none`) Prerequisites body still returns the one-bullet-per-line refusal.

## Documentation updates

- `v2/docs/spec-guidance.md` — ready-intent Prerequisites: omit or `none` for independent intents.

## Prerequisites
