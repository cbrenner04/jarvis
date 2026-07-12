---
name: write-step-rules-state-terminal-token-as-output-format
---

# Terminal-token step rules read as an output-format rule

`DEFAULT_WRITE_STEP_RULES` (`v2/src/execution/write-loop-input.ts:6`) renders as
"Return exactly one terminal token: done|no-work|blocked|progress." — an enum
description, not a formatting rule. Agents satisfy it with a prose summary of their
terminal state, the parser finds no bare token, and the step is recorded
`invalid_token`.

State the contract as an output-format rule: the final line of the response must be
exactly one of `done`, `no-work`, `blocked`, `progress`, with nothing after it. The
constant is shared, so the change must reach every write prompt that renders step
rules — `plan-draft`, `intent-split`, and the default write prompt — with the
rendered `## Step completion` section carrying the format rule in each.

Prompt wording only; token parsing stays strict and unchanged.

## Prerequisites

## Documentation updates

- `v2/docs/write-behavior.md` — the terminal-token output-format contract.
