---
name: intent-split-multi-surface-regression
---

# Split step fans out multi-surface seeds and keeps single-surface seeds whole

## Problem

Without a regression that drives the real split step, a surface rule in the prompt can drift while
operators still get one oversized ready-intent for cross-boundary fixes, or spurious fragmentation
for genuinely single-surface seeds.

## Decisions

- Regression uses a committed fixture seed whose fix explicitly spans persistence, daemon, and CLI surfaces — rules out inline-only or hand-authored ready-intent fixtures that skip the split write step.
- The test asserts separate staged intents each naming its surface — rules out counting files without checking surface identity in intent bodies.
- A second fixture seed is genuinely single-surface; the test asserts exactly one staged intent with a one-line unsplit rationale — rules out coupling single-surface coverage only to prompt prose.
- Agent output is stubbed; the test validates split-step wiring and post-split staging layout — rules out live model calls in CI.

## Acceptance criteria

- [ ] A regression test drives the intent split write step with a multi-surface fixture seed and asserts at least three staged ready-intents whose titles or bodies identify persistence, daemon, and CLI surfaces separately; it fails against the pre-change prompt and split behavior.
- [ ] The same harness drives a single-surface fixture seed and asserts exactly one staged ready-intent whose body states in one line why splitting does not apply; it fails against the pre-change prompt and split behavior.
- [ ] Inverting the multi-surface fan-out expectation turns the regression test RED.

## Documentation updates

- None — operator contract is covered in the split-prompt intent.

## Prerequisites

- The intent split prompt instructs one ready-intent per touched surface in dependency order.
- The intent split prompt instructs single-surface seeds to emit one ready-intent with a one-line unsplit rationale.
