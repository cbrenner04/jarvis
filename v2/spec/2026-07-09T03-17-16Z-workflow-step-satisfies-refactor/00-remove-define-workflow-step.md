# Remove defineWorkflowStep

`defineWorkflowStep` (`v2/src/execution/workflow-runner.ts:138`) is `(step) =>
step` — an identity function that exists only for its type annotation. Its
production caller (`resolveWorkflowPreset`, line 161) and test callers
(`workflow-runner.test.ts:130`, `:1064`) can express the same type check with
`satisfies` on the object literal, or by relying on an already-typed helper.

## Decisions

- Remove the wrapper rather than keep it for call-site brevity — rules out treating a same-object passthrough as worth a named export.
- Production caller's inline object literal gets `satisfies WorkflowStepInput`; test callers pass already-typed helper results (`createStepInput`, `createHumanStep`) directly, since those helpers already carry the needed return type — no `satisfies` needed there.

## Task Checklist

- [ ] Delete `defineWorkflowStep` from `v2/src/execution/workflow-runner.ts`.
- [ ] In `resolveWorkflowPreset`, replace `defineWorkflowStep({ ...step, behavior: "write", ...(pinned ?? {}) })` with `({ ...step, behavior: "write", ...(pinned ?? {}) }) satisfies WorkflowStepInput`.
- [ ] In `workflow-runner.test.ts`, replace `defineWorkflowStep(createStepInput({...}))` and `defineWorkflowStep(createHumanStep({...}))` call sites with direct calls to `createStepInput(...)` / `createHumanStep(...)`.
- [ ] Remove the now-unused `defineWorkflowStep` import from `workflow-runner.test.ts`.
- [ ] Rename the `describe("defineWorkflowStep", ...)` and `describe("defineWorkflowStep human steps", ...)` blocks to describe the behavior under test instead of the removed function (e.g. `describe("resolveWorkflowPreset step shape", ...)`, `describe("human step shape", ...)`), keeping the test bodies otherwise unchanged.

## Acceptance criteria

- [ ] `defineWorkflowStep` no longer exists anywhere in `v2/src/execution/workflow-runner.ts` or its test file.
- [ ] `workflow-runner.test.ts` stays green (behavior unchanged by the refactor).
- [ ] `bun run typecheck` passes.

## Documentation updates

None — internal refactor with no behavior, architecture, or operator-facing semantics change.
