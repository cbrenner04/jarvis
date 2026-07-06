# Write steps declare their own prompt id

`write.ts` always renders `write.execute` via `renderWriteExecutePrompt`
(`v2/src/execution/write-prompt.ts`). A step should be able to name a
different registry prompt id so presets can reuse `plan.*`/`patch.*`
artifacts without a new code path.

## Decisions

- `WriteExecuteInput` (`v2/src/execution/write.ts`) gains optional `promptId?: string`; `executeWrite` defaults it to `"write.execute"` when omitted — rules out silently changing the default prompt for existing callers.
- `renderWriteExecutePrompt` (`v2/src/execution/write-prompt.ts`) is replaced by `renderStepPrompt(promptId: string, placeholders: { specPath: string; stepRules: string })`, built on `renderArtifactTemplate` from `shared/prompts/render.ts`.
- `renderStepPrompt` always injects `write.principles` as `PRINCIPLES` regardless of `promptId` — matches current behavior; a prompt id whose template doesn't reference `<PRINCIPLES>` just ignores the unused value.
- `WriteLoopInput` (`v2/src/execution/write-loop.ts`) and `WriteWorkflowStep` (`v2/src/execution/workflow-runner.ts`) inherit `promptId` through their existing `WriteExecuteInput`/`Omit<WriteLoopInput, ...>` composition — no new field needed in either type beyond the one added to `WriteExecuteInput`.
- `buildWriteExecuteInput` in `write-loop.ts` forwards `args.promptId` into the `WriteExecuteInput` it builds for `executeWrite`.
- An unknown `promptId` propagates the registry's existing `unknown prompt id` error (`shared/prompts/registry.ts`) unchanged — no new error handling.

## Out of scope

- Authoring new plan/patch prompt bodies.
- NL `operator` role prompts.
- TUI prompt picker.
- Review-debate and human workflow steps (unaffected).

## Acceptance criteria

- [ ] A `WriteWorkflowStep`/`WriteLoopInput` with no `promptId` renders `write.execute` (default preserved): existing `write-loop.test.ts` and `workflow-runner.test.ts` write-step tests stay green.
- [ ] A `WriteWorkflowStep`/`WriteLoopInput` with `promptId` set to a different registered prompt id (e.g. `plan.prompt.draft`) causes `executeWrite` to render that artifact's body instead of `write.execute`, verified by a new test in `write.test.ts` or `write-loop.test.ts` asserting on the rendered prompt passed to `runStep`.
- [ ] `renderWriteExecutePrompt` no longer exists; `write-prompt.test.ts` covers `renderStepPrompt` instead, including the case where `promptId` names a nonexistent registry id and the registry's `unknown prompt id` error surfaces.

## Documentation updates

- None — internal harness wiring, no operator-facing behavior or documented workflow-step contract changes.
