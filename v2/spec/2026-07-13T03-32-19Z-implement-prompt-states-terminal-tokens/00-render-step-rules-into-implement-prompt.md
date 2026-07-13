# 00 - Render STEP_RULES into the implement prompt

## Problem

The implement write step carries `stepRules: DEFAULT_WRITE_STEP_RULES`
(`v2/src/execution/implement-workflow-steps.ts`), but its prompt
`patch.prompt.body` (`prompts/patch/instructions.md`) declares no `STEP_RULES`
placeholder. `assembleWriteStepPlaceholders` (`v2/src/execution/write.ts`) is
driven by the artifact's declared placeholders, so the value is silently
dropped. The implement agent is never shown the token vocabulary the harness
parses (`TERMINAL_TOKENS` in `v2/src/execution/step-runner.ts`), nor when
`progress` applies rather than `blocked`.

Only `write.execute` declares `STEP_RULES` today; the resolver switch in
`write.ts` already handles the name, so no resolver change is needed.

## Decisions

- Declare `STEP_RULES:string!` in `prompts/patch/instructions.md` and interpolate
  `<STEP_RULES>` — rules out duplicating the token vocabulary in
  `prompts/patch/rules.md`, which would create two divergent copies.
- Extend `DEFAULT_WRITE_STEP_RULES` itself to state each token's meaning rather
  than adding patch-only token prose — rules out the divergence the shared
  constant exists to prevent; the semantics (work remains vs. stuck) are the
  same for every write step.
- `blocked` obligates a `## Blocker` section in the spec, stated in the shared
  rules text.
- Leave `patch.prompt.shrink` unchanged — it is a hidden non-token pass.

## Task checklist

- [ ] Extend `DEFAULT_WRITE_STEP_RULES` (`v2/src/execution/write-loop-input.ts`)
      to name the four tokens, distinguish `progress` (work remains, agent not
      stuck) from `blocked` (stuck), and state the `## Blocker` obligation.
- [ ] Add `STEP_RULES:string!` to the `placeholders:` list and a `<STEP_RULES>`
      token to the body of `prompts/patch/instructions.md`; bump its `revision`.
- [ ] Extend the `patch.prompt.body` case in `v2/src/execution/write.test.ts` to
      assert the rendered prompt contains `DEFAULT_WRITE_STEP_RULES`.
- [ ] Update `v2/docs/prompts.md` and `v2/docs/write-behavior.md`.

## Acceptance criteria

- [ ] The rendered `patch.prompt.body` prompt contains the step rules text, and a
      test in `v2/src/execution/write.test.ts` pins that it does by referencing
      `DEFAULT_WRITE_STEP_RULES` (not a copied string literal).
- [ ] The step rules text names exactly `done`, `no-work`, `blocked`, `progress`
      as the required final line, states that `progress` is the token when work
      remains and the agent is not stuck, and states that `blocked` obligates a
      `## Blocker` section in the spec.
- [ ] `prompts/patch/instructions.md` declares `STEP_RULES:string!` and carries a
      `<STEP_RULES>` token, with `revision` bumped.
- [ ] Existing prompt/write tests stay green (`v2/src/execution/write-prompt.test.ts`,
      `v2/src/execution/write.test.ts`, `v2/src/execution/step-runner.test.ts`,
      `shared/prompts` registry tests) — the shared rules text is referenced by
      constant, not duplicated.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/prompts.md` — `patch.prompt.body` now declares `STEP_RULES`.
- `v2/docs/write-behavior.md` — write-step placeholder table lists `STEP_RULES`
  for `patch.prompt.body`; the "Terminal token" section records the expanded
  rules text (token meanings, `## Blocker` obligation).
