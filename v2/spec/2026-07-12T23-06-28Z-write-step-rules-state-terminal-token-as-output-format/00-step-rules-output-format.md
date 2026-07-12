# 00 - Step rules state the terminal-token output format

`DEFAULT_WRITE_STEP_RULES` (`v2/src/execution/write-loop-input.ts:6`) reads as an enum
description, not a formatting rule, so agents answer with a prose summary of their terminal
state and the step is recorded `invalid_token`. Restate it as an output-format rule.

## Decisions

- Reword `DEFAULT_WRITE_STEP_RULES` only; token parsing (`parseStepOutcomeToken`) stays unchanged — rules out loosening the parser to accept prose, which would let a mistaken token in a summary sentence decide the step.
- Wording pins the *final line* of the response to a bare token with nothing after it, and lists the four tokens — rules out "start your response with" or "include the token somewhere", neither of which matches the parser's last-line preference.
- The constant is the single source: every write prompt (`plan-draft`, `intent-split`, default write) renders it through `stepRules`, so no per-prompt wording is added — rules out prompt-specific copies that drift.

## Acceptance criteria

- [ ] `DEFAULT_WRITE_STEP_RULES` states an output-format rule: the response's final line must be exactly one of `done`, `no-work`, `blocked`, `progress`, with nothing after it.
- [ ] The rendered `## Step completion` section of all three write prompts — `plan.prompt.draft`, `intent.prompt.split`, and the default write prompt — carries that format rule (it is rendered from the shared constant).
- [ ] `parseStepOutcomeToken` behavior is unchanged: `v2/src/execution/step-runner.test.ts` stays green.
- [ ] `v2/src/execution/write-loop-input.test.ts` and `v2/src/execution/write.test.ts` assert the new wording rather than the old enum sentence.

## Documentation updates

- `v2/docs/write-behavior.md` — document the terminal-token output-format contract the step rules state (final line, bare token, one of the four), alongside the existing `invalid_token` handling.
