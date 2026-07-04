# Workflow-authoring helper and named presets

`executeWorkflow` (`v2/src/execution/workflow-runner.ts`) takes a `WorkflowStep[]` —
each step is `WriteLoopInput & { stepId; role }` (`WriteLoopInput` is `WriteExecuteInput`
plus per-step loop-control fields: `maxIterations`, `signal`, `pauseSignal`). Callers
hand-roll this shape today. Add an authoring helper that builds one step from
`{ behavior, prompt, role }`-shaped input, and ship named presets built with it
that resolve by name to a concrete `WorkflowStep[]`.

## Decisions

- Helper and presets live in the same module/PR — presets are the helper's only caller; no second caller exists to generalize against yet.
- `behavior` is a discriminated field on the helper's input; only `"write"` is a valid value today (only behavior the runner exercises), mirroring `role-resolution.md`'s behavior vocabulary.
- The helper's input type is a superset covering every `WriteLoopInput` field, including the per-step loop-control fields (`maxIterations`, `signal`, `pauseSignal`); the helper passes them through to the returned `WorkflowStep` untouched rather than dropping them.
- Presets are static TS source (an object/function keyed by name), not a JSON/config file — rules out treating preset shape as user-editable config.
- A preset fixes the step **count and behavior sequence** only (e.g. `"write-write"` → two `write` steps); it does not hardcode `role` values, since role choice is a per-usage product decision the intent does not make. Callers supply `role` (and all other per-step content: `worktree`, `specPath`, `stepRules`, `expectedArtifactPath`, `bindings`) per step position.
- `resolveWorkflowPreset` composes `defineWorkflowStep` internally (one call per position) rather than duplicating its construction logic.
- The `steps` param callers pass to `resolveWorkflowPreset` omits `behavior` per position — the preset's fixed sequence supplies it — and otherwise carries the same per-step content `defineWorkflowStep` takes.
- Resolving an unknown preset name throws synchronously rather than returning `undefined`/`[]` — matches `executeWorkflow`'s existing synchronous-validation style (empty `steps`, duplicate `stepId`). A `steps` array whose length doesn't match the preset's fixed step count is the same validation family and throws synchronously too.
- `bindings` (role→model resolution) and agent fallback order remain caller-supplied inputs, unchanged — this slice does not touch `agent-model-config.ts` or binding construction.

## Task Checklist

- [ ] Add `defineWorkflowStep` (or equivalent) to `v2/src/execution/` that takes `{ stepId, role, behavior: "write", ...WriteLoopInput fields }` and returns a `WorkflowStep`, passing `maxIterations`/`signal`/`pauseSignal` through untouched.
- [ ] Add `resolveWorkflowPreset(name, steps)` (or equivalent) that composes `defineWorkflowStep` per position, validates the supplied per-step content (each entry omitting `behavior`) against a named preset's fixed step count and behavior sequence, and returns a `WorkflowStep[]`.
- [ ] Implement the `"write-write"` preset: two-step, `write`→`write`.
- [ ] Unit tests for the helper and the preset resolver, including the unknown-name error path and the wrong-step-count error path.

## Documentation updates

- Add an "Authoring helper and presets" section to `v2/docs/workflow-runner.md` documenting `defineWorkflowStep`'s and `resolveWorkflowPreset`'s contracts, cross-linked from `role-resolution.md` where behaviors are defined.
- Add a one-line cross-link from `v2/docs/write-behavior.md` to the new `workflow-runner.md` section, since the helper wraps the write-behavior input shape directly.

## Acceptance criteria

- [x] `defineWorkflowStep` builds a `WorkflowStep` consumable by `executeWorkflow` from `{ stepId, role, behavior, ... }` input, without the caller constructing the `WriteLoopInput & { stepId; role }` shape by hand, and without dropping `maxIterations`/`signal`/`pauseSignal` when supplied.
- [x] `resolveWorkflowPreset("write-write", ...)` returns a two-element `WorkflowStep[]` (behavior sequence write→write) that `executeWorkflow({ steps })` accepts and runs.
- [x] Resolving an unregistered preset name throws an error whose message includes the invalid preset name, instead of returning an empty or undefined result.
- [x] Calling `resolveWorkflowPreset("write-write", steps)` with a `steps` array whose length is not 2 throws synchronously instead of returning a mismatched-length result.
- [x] `workflow-runner.test.ts` and `step-runner.test.ts` stay green (no behavior change to the runner or step runner).
