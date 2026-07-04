# Workflow-authoring helper and named presets

`executeWorkflow` (`v2/src/execution/workflow-runner.ts`) takes a `WorkflowStep[]` —
each step is `WriteExecuteInput & { stepId; role }`. Callers hand-roll this shape
today. Add an authoring helper that builds one step from `{ behavior, prompt,
role }`-shaped input, and ship named presets built with it that resolve by name
to a concrete `WorkflowStep[]`.

## Decisions

- Helper and presets live in the same module/PR — presets are the helper's only caller; no second caller exists to generalize against yet.
- `behavior` is a discriminated field on the helper's input; only `"write"` is a valid value today (only behavior the runner exercises), mirroring `role-resolution.md`'s behavior vocabulary.
- Presets are static TS source (an object/function keyed by name), not a JSON/config file — rules out treating preset shape as user-editable config.
- A preset fixes the step **count and behavior sequence** only (e.g. `"write-write"` → two `write` steps); it does not hardcode `role` values, since role choice is a per-usage product decision the intent does not make. Callers supply `role` (and all other per-step content: `worktree`, `specPath`, `stepRules`, `expectedArtifactPath`, `bindings`) per step position.
- Resolving an unknown preset name throws synchronously rather than returning `undefined`/`[]` — matches `executeWorkflow`'s existing synchronous-validation style (empty `steps`, duplicate `stepId`).
- `bindings` (role→model resolution) and agent fallback order remain caller-supplied inputs, unchanged — this slice does not touch `agent-model-config.ts` or binding construction.

## Task Checklist

- [ ] Add `defineWorkflowStep` (or equivalent) to `v2/src/execution/` that takes `{ stepId, role, behavior: "write", ...write-specific fields }` and returns a `WorkflowStep`.
- [ ] Add `resolveWorkflowPreset(name, steps)` (or equivalent) that validates the supplied per-step content against a named preset's fixed behavior sequence and returns a `WorkflowStep[]`.
- [ ] Implement the `"write-write"` preset: two-step, `write`→`write`.
- [ ] Unit tests for the helper and the preset resolver, including the unknown-name error path.

## Documentation updates

- Add an "Authoring helper and presets" section to `v2/docs/workflow-runner.md` documenting `defineWorkflowStep`'s and `resolveWorkflowPreset`'s contracts, cross-linked from `role-resolution.md` where behaviors are defined.

## Acceptance criteria

- [ ] `defineWorkflowStep` builds a `WorkflowStep` consumable by `executeWorkflow` from `{ stepId, role, behavior, ... }` input, without the caller constructing the `WriteExecuteInput & { stepId; role }` shape by hand.
- [ ] `resolveWorkflowPreset("write-write", ...)` returns a two-element `WorkflowStep[]` (behavior sequence write→write) that `executeWorkflow({ steps })` accepts and runs.
- [ ] Resolving an unregistered preset name throws a descriptive error instead of returning an empty or undefined result.
- [ ] `workflow-runner.test.ts` and `step-runner.test.ts` stay green (no behavior change to the runner or step runner).
