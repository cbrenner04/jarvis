---
name: prnarrative-default-deliberate-choice
---

# Operator chooses `prNarrative` default deliberately, with documented tradeoff

## Problem

`prNarrative` defaults to `template` for both patch and plan (`v1/src/config.ts`),
yet `agent` produces markedly better descriptions on the same changes (intake
issue #521). The default is the silent path most PRs take, so a low-value
default under-serves review on every PR that doesn't opt into `agent`. The
deterministic/cheap vs. contextual/token-heavier tradeoff is not surfaced for
the operator to weigh.

## Direction

Make the default a deliberate, documented choice:
- either flip the `prNarrative` default to `agent` (patch + plan), or keep
  `template` — but document the deterministic-cheap vs. agent-contextual
  tradeoff so the operator chooses knowingly
- whichever default ships, document the override path and cost implication

Update `v1/docs/worktrees-and-commits.md` PR narrative section and
`v2/docs/v1-behaviors.md` to record the chosen default and the tradeoff.

## Out of scope

- Improving `template` output quality (separate behavior).
- The `agent` sentinel extraction contract (already works).
- Removing `template` mode.

## Prerequisites

- prNarrative supports both template and agent modes selectable via modes.patch.prNarrative and modes.plan.prNarrative
