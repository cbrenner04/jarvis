---
name: intent-split-multi-surface-regression
---

# Multi-surface seeds fan out into surface-named ready-intents

## Problem

Without a regression that drives the real split step, a surface rule in the prompt can drift while
operators still get one oversized ready-intent for cross-boundary fixes.

## Decisions

- Regression uses a committed fixture seed whose fix explicitly spans persistence, daemon, and CLI
  surfaces — rules out inline-only or hand-authored ready-intent fixtures that skip the split write
  step.
- The test asserts separate staged intents each naming its surface — rules out counting files without
  checking surface identity in intent bodies.
- Agent output is stubbed; the test validates split-step wiring and post-split staging layout — rules
  out live model calls in CI.

## Acceptance criteria

- [ ] A regression test drives the intent split write step with a multi-surface fixture seed and
      asserts at least three staged ready-intents whose titles or bodies identify persistence, daemon,
      and CLI surfaces separately; it fails against the pre-change prompt and split behavior.
- [ ] Inverting the fan-out expectation (e.g. expecting a single intent) turns the regression test
      RED.

## Documentation updates

- None — operator contract is covered in the split-prompt intent.

## Prerequisites

- The intent split prompt instructs one ready-intent per touched surface in dependency order.
