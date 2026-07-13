---
name: implement-prompt-states-terminal-tokens
---

# The implement agent is never told the terminal-token vocabulary

## Problem

`DEFAULT_WRITE_STEP_RULES` is carried on the implement write step
(`v2/src/execution/implement-workflow-steps.ts`) but
`prompts/patch/instructions.md` (`patch.prompt.body`) declares no `STEP_RULES`
placeholder, and `assembleWriteStepPlaceholders` only resolves declared names.
The rules are never rendered. The implement agent sees the four tokens nowhere,
and sees no statement of when `progress` applies rather than `blocked`.

Suspected cause of the 2026-07-13 run that emitted `blocked` after completing
subspec `00` with subspec `01` still unstarted — `progress` was the token it
wanted.

## Behavior

- The implement prompt states the terminal-token contract the harness actually
  parses: exactly one of `done`, `no-work`, `blocked`, `progress` as the final
  line.
- It distinguishes `progress` from `blocked` on a multi-subspec index: work
  remains and the agent is not stuck ⇒ `progress`.
- It states that `blocked` obligates a `## Blocker` section in the spec.

## Decisions

- Render the shared `STEP_RULES` into the implement prompt rather than
  duplicating token text in `prompts/patch/rules.md` — rules out two divergent
  copies of the token vocabulary.
- A test pins that the rendered implement prompt contains the token rules —
  rules out silent regression the next time placeholders are re-declared.

## Out of scope

- Harness-side verification of the `blocked` token (separate behavior).

## Documentation updates

- `v2/docs/prompts.md` — implement prompt's `STEP_RULES` placeholder.
- `v2/docs/write-behavior.md` — write-step placeholder table.

## Prerequisites

- Write-step prompts resolve placeholders from the registry's declared requirements for the step's `promptId`.
- `DEFAULT_WRITE_STEP_RULES` is carried on implement workflow write steps.
