# 00 - Step rules state the terminal-token output format

`DEFAULT_WRITE_STEP_RULES` (`v2/src/execution/write-loop-input.ts:6`) reads as an enum
description ("Return exactly one terminal token: done|no-work|blocked|progress."), not a
formatting rule, so agents do not reliably emit a bare final-line token. The outcome is then
decided by `parseStepOutcomeToken`'s lenient fallback tiers — a token word anywhere in stdout
wins — or, when no token word appears at all, the step records `invalid_token`. Restate the
constant as an output-format rule. Prompt wording only.

## Decisions

- Reword `DEFAULT_WRITE_STEP_RULES` only; `parseStepOutcomeToken` stays unchanged — rules out changing the parser in the same breath. It is already lenient (exact match → last bare-token line → last token word anywhere in stdout); the reword makes those fallback tiers unnecessary, and parser strictness is a separate concern.
- Wording pins the *final line of the response* to a bare token with nothing after it, and lists the four tokens — targets the parser's explicit bare-token-line tier; rules out "start your response with" or "include the token somewhere", which only land on the last-token-word fallback.
- Wording is self-anchoring on the response, not on the prompt section — `daemon-revise` appends the operator prompt *after* the step rules, so section-relative phrasing ("end this section with…") is defeatable.
- The constant is the single source; no per-prompt wording is added — rules out prompt-specific copies that drift.

## Scope

Reached: the three surfaces that render the constant — `write.execute` (default write prompt),
`plan.prompt.draft`, `intent.prompt.split`.

Out of scope, named not fixed:

- `patch.prompt.body` (implement) sets `stepRules: DEFAULT_WRITE_STEP_RULES` but declares no `STEP_RULES` placeholder, and `executeDefaultWrite` wires `STEP_RULES` only for `write.execute`; every other promptId renders from `promptPlaceholders`, which the implement step never populates. The implement step's step rules are dead text on the payload — a distinct plumbing defect, its own intent.
- The daemon reattach path (`daemon.ts` reconstructs with `stepRules: ""`).

## Acceptance criteria

- [ ] `DEFAULT_WRITE_STEP_RULES` states an output-format rule anchored on the response: its final line must be exactly one of `done`, `no-work`, `blocked`, `progress`, with nothing after it.
- [ ] Call-site plumbing is unchanged — `write-loop-input.ts`, `plan-workflow-steps.ts`, and `intent-workflow-steps.ts` still pass `DEFAULT_WRITE_STEP_RULES` as `stepRules`: `v2/src/execution/write-loop-input.test.ts`, `v2/src/execution/plan-workflow-steps.test.ts`, and `v2/src/execution/intent-workflow-steps.test.ts` stay green.
- [ ] `parseStepOutcomeToken` behavior is unchanged: `v2/src/execution/step-runner.test.ts` stays green.
- [ ] Every site hardcoding the old sentence asserts the new wording instead: `v2/src/cli.test.ts` (2 sites), `v2/src/tui/tui-daemon-client.test.ts`, `v2/src/execution/write.test.ts`, `shared/prompts/plan-draft.test.ts`, `shared/prompts/intent-split.test.ts`.
- [ ] `bun run typecheck`, `test:v1`, `test:v2`, and `test:integration:v2` pass (the change touches `shared/**`, so the repo scope rule unions all three suites).

## Documentation updates

- `v2/docs/write-behavior.md` — the terminal-token contract, both halves stated explicitly: the *prompt* demands a bare final-line token (one of the four); the *parser* tolerates less (lenient tiers) and records `invalid_token` only when no token word appears anywhere. Cross-link `v2/docs/shared-step-runner.md` (parser) and `v2/docs/prompts.md` (`## Step completion` suffix) rather than restating them; do not assert strictness the parser does not enforce.
- `v2/docs/v1-behaviors.md` — add a line only if the reworded prompt is v1-visible; confirm during implementation, skip if not.
