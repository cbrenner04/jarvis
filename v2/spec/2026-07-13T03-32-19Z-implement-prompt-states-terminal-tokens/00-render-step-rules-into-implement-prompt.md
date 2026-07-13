# 00 - Render STEP_RULES into the implement and shrink prompts

## Problem

The implement write step carries `stepRules: DEFAULT_WRITE_STEP_RULES`
(`v2/src/execution/implement-workflow-steps.ts`), and the hidden shrink step
inherits it by spread (`v2/src/execution/workflow-runner.ts`). Neither
`prompts/patch/instructions.md` (`patch.prompt.body`) nor `prompts/patch/shrink.md`
(`patch.prompt.shrink`) declares a `STEP_RULES` placeholder, and
`assembleWriteStepPlaceholders` (`v2/src/execution/write.ts`) resolves only
declared names — so the value is silently dropped on both. Both steps run through
`executeWriteLoop`/`runStep` and are parsed for a terminal token
(`TERMINAL_TOKENS`, `v2/src/execution/step-runner.ts`), so both have the same defect.

The agent is not in a total blackout: a tokenless response triggers one
`write.token-reprompt` pass, which names the four tokens but not their meanings.
So the agent never sees when `progress` applies rather than `done` or `blocked` —
the ambiguity behind the 2026-07-13 run that emitted `blocked` after finishing
subspec `00` with `01` unstarted.

Only `write.execute` declares `STEP_RULES` today; the resolver switch in
`write.ts` already handles the name, so no resolver change is needed.

## Decisions

- Declare `STEP_RULES:string!` in `prompts/patch/instructions.md` and
  `prompts/patch/shrink.md`, interpolating `<STEP_RULES>` as each body's last
  block — rules out duplicating the token vocabulary in `prompts/patch/rules.md`,
  which would create two divergent copies; last-block placement because the rule
  governs the final line of output.
- Fix shrink in the same change — it is not a non-token pass: it inherits
  `stepRules` from the spread implement step and its output is token-parsed.
- Define all four tokens in `DEFAULT_WRITE_STEP_RULES`, not just `progress` vs
  `blocked` — the runtime split is asymmetric (`progress` re-iterates and skips
  contracts; `done`/`no-work` run the artifact contract and end the loop), and
  the originating incident was a `done`-vs-`progress` ambiguity.
- The shared text stays mode-neutral: it reaches plan draft and intent split as an
  appended `## Step completion` section, where the blocker lands in `intent.md` or
  nowhere — so the constant says to record the blocker where the mode's rules
  require, and the patch-scoped binding (append `## Blocker` ⇒ emit `blocked`)
  goes in `prompts/patch/rules.md` §Stop, which already owns the `## Blocker`
  obligation but names no token.

## Task checklist

- [ ] Extend `DEFAULT_WRITE_STEP_RULES` (`v2/src/execution/write-loop-input.ts`)
      to define all four tokens and carry a mode-neutral blocker clause.
- [ ] Add `STEP_RULES:string!` to `placeholders:` and a trailing `<STEP_RULES>`
      block in `prompts/patch/instructions.md` and `prompts/patch/shrink.md`; bump
      each `revision`.
- [ ] Add the `## Blocker` ⇒ `blocked` binding to `prompts/patch/rules.md` §Stop;
      bump its `revision`.
- [ ] Extend `v2/src/execution/write.test.ts` to assert the rendered
      `patch.prompt.body` and `patch.prompt.shrink` prompts contain
      `DEFAULT_WRITE_STEP_RULES`.
- [ ] Refresh prompt snapshot fixtures whose rendered bytes change (the patch
      artifacts; the plan-draft / intent-split `## Step completion` suffix — no
      revision bump is owed there, the artifact bodies do not change).
- [ ] Update `v2/docs/prompts.md` and `v2/docs/write-behavior.md`.

## Acceptance criteria

- [ ] The rendered `patch.prompt.body` and `patch.prompt.shrink` prompts contain
      the step rules text as their final block, and tests in
      `v2/src/execution/write.test.ts` pin that by referencing
      `DEFAULT_WRITE_STEP_RULES` (not a copied string literal).
- [ ] The step rules text names exactly `done`, `no-work`, `blocked`, `progress`
      as the required final line and defines each: `done` / `no-work` end the step,
      `progress` when work remains and the agent is not stuck, `blocked` when stuck.
- [ ] The step rules text is mode-neutral — its blocker clause names no spec file —
      and `prompts/patch/rules.md` §Stop states that appending `## Blocker` means
      the final line is `blocked`.
- [ ] `prompts/patch/instructions.md` and `prompts/patch/shrink.md` each declare
      `STEP_RULES:string!` and carry `<STEP_RULES>` as the last block, with
      `revision` bumped; `prompts/patch/rules.md` `revision` bumped.
- [ ] `bun run typecheck` and `bun run test` pass (`prompts/**` is root-level and
      consumed through the `shared/prompts` registry, so the full suite is the gate).

## Documentation updates

- `v2/docs/prompts.md` — `patch.prompt.body` and `patch.prompt.shrink` declare
  `STEP_RULES`.
- `v2/docs/write-behavior.md` — write-step placeholder table lists `STEP_RULES`
  for both patch prompts; the "Terminal token" section records the expanded rules
  text (four token meanings, mode-neutral blocker clause) and the patch-rules
  `## Blocker` ⇒ `blocked` binding.
