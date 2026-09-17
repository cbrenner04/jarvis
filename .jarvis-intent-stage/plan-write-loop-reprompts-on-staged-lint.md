---
name: plan-write-loop-reprompts-on-staged-lint
---

# A plan draft failing staged markdown lint is reprompted with the lint output before settling

## Problem

When a plan write step's staged tree fails markdown lint, the write loop (`v2/src/execution/write-loop.ts`) settles `landing_failed` / `resumable: false` immediately. The review path already reprompts the actuator with post-actuator lint output; the plan draft path has no equivalent, so a one-line formatting defect strands the lane (issue #3949, 3 strands).

## Decisions

- On a plan write-step staged-markdown-lint failure, the loop reprompts the drafter with the lint rule id, offending file, and message — reusing the existing `stagedMarkdownLintReprompt` carrier rather than a parallel channel.
- Reprompts consume the existing reprompt budget; no new budget or retry knob. Rules out unbounded retries on a lint defect the model cannot fix.
- Budget exhaustion still settles `landing_failed`, leaving the staged tree in place for recovery.

## Acceptance criteria

- [ ] A write-loop test asserts a plan draft whose staged tree fails markdown lint is reprompted with the lint output before settling; it fails against the pre-fix loop.
- [ ] A write-loop test asserts that once the reprompt budget is exhausted the row settles `landing_failed` with the staged tree preserved.
- [ ] `bun run typecheck`, `bun run test:v2`, `bun run test:integration:v2`, and `bun run test:shared` pass.

## Prerequisites

- The decisions-ledger prompt guidance requires a Markdown bullet list rather than one entry per bare line.
- The plan-draft normalizer converts bare lines under `## Decisions` into bullets before staged lint runs.

## Documentation updates

- `v2/docs/write-behavior.md` — plan write-step staged-lint reprompt within the reprompt budget.
- `v2/docs/v1-behaviors.md` — record the changed plan write-step settle behavior.
