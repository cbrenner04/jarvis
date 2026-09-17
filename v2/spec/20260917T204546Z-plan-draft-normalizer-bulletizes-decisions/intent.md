---
name: plan-draft-normalizer-bulletizes-decisions
---

# Plan-draft normalizer converts bare decision lines into bullets before staged lint

## Problem

Even with corrected prompt guidance, an older or disobedient drafter still emits bare consecutive lines under `## Decisions`, and the `no-hard-wrap` staged lint rejects the draft identically. The normalizer (`normalizePlanDraftSpecDir`, `shared/module-boundary-surfaces.ts`, invoked from `v2/src/execution/write.ts`) passes such runs through untouched.

## Decisions

- The normalizer converts a run of bare non-blank lines directly under `## Decisions` into `-` bullet items, in place, before staged lint runs.
- Scope is the `## Decisions` section only; other sections are left alone, so this cannot mangle prose or code fences elsewhere.
- Lines already bulleted, blank, or fenced are left unchanged; rules out an unconditional rewrite that would double-bullet a compliant draft.

## Acceptance criteria

- [ ] A normalizer test asserts bare consecutive lines under `## Decisions` become bullet items and the normalized result passes staged markdown lint; it fails against the current normalizer.
- [ ] A normalizer test asserts an already-bulleted `## Decisions` section and non-`Decisions` sections are unchanged.
- [ ] `bun run typecheck`, `bun run test:v2`, `bun run test:integration:v2`, and `bun run test:shared` pass.

## Prerequisites

- The decisions-ledger prompt guidance requires a Markdown bullet list rather than one entry per bare line.

## Documentation updates

- `v2/docs/v1-behaviors.md` — record the normalizer's `## Decisions` bulletization.
