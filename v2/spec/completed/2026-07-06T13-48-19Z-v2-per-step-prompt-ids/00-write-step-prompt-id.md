# Write steps declare their own prompt id

`write.ts` always renders `write.execute` via `renderWriteExecutePrompt`
(`v2/src/execution/write-prompt.ts`), which hardcodes a `{specPath,
stepRules}` placeholder tuple. A step should be able to name a different
registry prompt id so presets can reuse `plan.*`/`patch.*` artifacts without
a new code path — but those artifacts declare placeholder sets
(`plan/draft.md`: `WORKDIR!, NAME!, INTENT!, SPEC_GUIDANCE!`;
`patch/instructions.md`: `SPEC_PATH!, SIBLINGS_BLOCK!, REPO_GUIDANCE!,
ACTIVE_SUBSPEC_PATH!, ACTIVE_SUBSPEC_BODY!, PATCH_RULES!`) that a fixed
`{specPath, stepRules}` shape cannot satisfy. The rendering helper must take
an arbitrary placeholder map instead.

## Decisions

- `WriteExecuteInput` (`v2/src/execution/write.ts`) gains optional `promptId?: string`; `executeWrite` defaults it to `"write.execute"` when omitted — rules out silently changing the default prompt for existing callers.
- `renderWriteExecutePrompt` (`v2/src/execution/write-prompt.ts`) is replaced by `renderStepPrompt(promptId: string, placeholders: Record<string, string>)`, built directly on `renderArtifactTemplate` from `shared/prompts/render.ts`. It does not hardcode any placeholder names — rules out baking write-specific assumptions (e.g. `SPEC_PATH`/`STEP_RULES`) into a helper other behaviors must reuse.
- The `PRINCIPLES` placeholder is no longer injected by `renderStepPrompt` itself. `executeWrite`'s call site builds the placeholder map for the default `write.execute` path (`SPEC_PATH`, `STEP_RULES`, `PRINCIPLES` from `write.principles`); a caller rendering a different `promptId` supplies whatever map that artifact's declared placeholders require and omits `PRINCIPLES` if the target artifact doesn't declare it.
- `WriteLoopInput` (`v2/src/execution/write-loop.ts`) and `WriteWorkflowStep` (`v2/src/execution/workflow-runner.ts`) inherit `promptId` through their existing `WriteExecuteInput`/`Omit<WriteLoopInput, ...>` composition — no new field needed in either type beyond the one added to `WriteExecuteInput`.
- `buildWriteExecuteInput` in `write-loop.ts` forwards `args.promptId` into the `WriteExecuteInput` it builds for `executeWrite`.
- `renderArtifactTemplate`'s existing `PromptRenderingError` (unknown/missing/type-mismatch placeholder, from `shared/prompts/render.ts`) and the registry's unknown-id lookup error propagate uncaught out of `executeWrite` — no new `WriteLoopOutcomeKind` mapping. A non-default `promptId` whose placeholder needs aren't met by the caller's map is a caller wiring bug, not a runtime outcome to recover from.
- No current call site constructs a step with a non-default `promptId` yet (TUI picker and new plan/patch prompt bodies are out of scope below) — the new test in this subspec is the sole proof the mechanism renders a non-`write.execute` artifact correctly.

## Out of scope

- Authoring new plan/patch prompt bodies.
- NL `operator` role prompts.
- TUI prompt picker.
- Review-debate and human workflow steps (unaffected).

## Acceptance criteria

- [x] A `WriteWorkflowStep`/`WriteLoopInput` with no `promptId` renders `write.execute` (default preserved): existing `write-loop.test.ts` and `workflow-runner.test.ts` write-step tests stay green.
- [x] A `WriteWorkflowStep`/`WriteLoopInput` with `promptId` set to a different registered prompt id whose declared placeholders are unrelated to `SPEC_PATH`/`STEP_RULES` (e.g. `plan.prompt.draft`, needing `WORKDIR`/`NAME`/`INTENT`/`SPEC_GUIDANCE`) causes `executeWrite` to render that artifact's body from a caller-supplied placeholder map, verified by a new test in `write.test.ts` or `write-loop.test.ts` asserting on the rendered prompt passed to `runStep`.
- [x] `renderStepPrompt(promptId, placeholders)` renders any registered artifact from an arbitrary placeholder map (not just `{specPath, stepRules}`), and an unknown `promptId` or a placeholder map missing a required declared placeholder surfaces the registry/render layer's existing error uncaught. `renderWriteExecutePrompt` no longer exists; `write-prompt.test.ts` covers `renderStepPrompt` instead, including both error cases.

## Documentation updates

- `v2/docs/prompts.md`'s Write rollout-layering line ("`write.principles` (body) substituted into `<PRINCIPLES>` placeholder in `write.execute` (v2-only; no layered global/behavior fragments)") documents `write.execute` as the fixed, sole write-step prompt. Update it to note write steps may render any registered prompt id via a caller-supplied placeholder map, with `write.execute` remaining the default and the only id that wires in `write.principles`.
