# Document nested plan-draft staging

## Problem

Operator docs and injected spec guidance still describe plan-draft staging as top-level-only, so the accepted flat-or-single-nested staging contract is undocumented.

## Decision ledger

- Align durable docs with subspec 00 in one docs-only subspec; rules out deferring operator-facing staging semantics to a follow-up PR.
- Clarify staging form in injected `v1/docs/spec-guidance.md` without changing durable on-main spec layout guidance; rules out rewriting durable `spec/<timestamp>-<slug>/` conventions.
- Subspec 01 owns intent-level harness gates (`typecheck`, `test:v2`, `test:integration:v2`); rules out index-routed completion with orphan intent checkboxes.

## Prerequisites

- Subspec 00 lands nested staging resolution and flattening in `write.ts`.

## Task checklist

- Update `v2/docs/write-behavior.md` **Draft output shape contract**: staging accepts flat `.jarvis-plan-stage/{index.md,NN-*.md}` or exactly one `.jarvis-plan-stage/spec/<name>/` tree, flattens nested input before normalization, and lands the same durable spec layout as flat input.
- Update `v2/docs/v1-behaviors.md` draft output shape bullet (~line 219): record the v2 additive flat-or-single-nested staging acceptance and flatten-before-normalize behavior.
- Update `v1/docs/spec-guidance.md`: state that plan-draft staging accepts flat or single-nested input under `.jarvis-plan-stage/` and lands one identical durable spec layout; leave durable `spec/<timestamp>-<slug>/` guidance unchanged.

## Acceptance criteria

- [x] `v2/docs/write-behavior.md` documents that plan-draft staging accepts flat or single-nested input, flattens nested trees before normalization, and lands one identical durable spec layout.
- [x] `v2/docs/v1-behaviors.md` records the flat-or-single-nested plan-draft staging acceptance relative to the prior top-level-only shape contract.
- [x] `v1/docs/spec-guidance.md` clarifies plan-draft staging accepts flat or single-nested input without changing durable spec layout guidance.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/write-behavior.md` — plan-draft staging shape contract (flat or single-nested, flatten, identical durable landing).
- `v2/docs/v1-behaviors.md` — v2 additive staging acceptance change.
- `v1/docs/spec-guidance.md` — staging form clarification only.
