# Route reviewed-intent review step through `loadWorkflowSteps`

`buildReviewedIntentWorkflowSteps` (`v2/src/execution/intent-workflow-steps.ts`)
builds its review step by loading machine config inline —
`loadMachineConfig` + `loadMachineProfileModels` + per-role
`resolveInvocationBindings` in a try/catch (lines ~318-364). Its write/split step
already flows through `loadWorkflowSteps`; only the review step bypasses it.
Route the review step through `loadWorkflowSteps` (subspec 00) so both step
kinds share the one loader pipeline and review binding misses aggregate at load.

Depends on subspec 00.

## Decisions

- The builder assembles a `WorkflowSourceStep` review variant (`behavior: "review"`, `stepId`, `project`, `branch`, `cwd`, `prompt`, `verdictPath`, `maxCycles`, and `deferredIntentOutput` when configured), then runs it through `loadWorkflowSteps`; rules out keeping inline `loadMachineConfig`/`loadMachineProfileModels`/`resolveInvocationBindings`.
- Review binding validation comes from the loader's aggregated `(stepId, role, agent)` error, not the builder's per-role `resolveInvocationBindings` try/catch; rules out a runtime-only critic/actuator failure.
- Loader failures continue to surface as the builder's caller-facing `{ ok: false; error }`, matching how the split step already handles loader throws; rules out letting a load throw escape the builder.
- Review composition is otherwise unchanged: same `stepId: "review"`, `intent.prompt.review` prompt, `.jarvis-intent-review-verdict.md` verdict path, `maxCycles === reviewPasses`, and deferred-landing wiring; rules out re-deriving verdict/landing semantics.
- `deps.machineConfigPath`/`machineProfile`/`machinesDir`/`createBinding` reach the review load through the same `loadWorkflowSteps` seam the split step uses; rules out the builder retaining an independent config-load seam.

## Task checklist

- Build the review `WorkflowSourceStep` and pass it through `loadWorkflowSteps`.
- Remove the inline `loadMachineConfig`/`loadMachineProfileModels`/`resolveInvocationBindings` block and now-unused imports.
- Attach `deferredIntentOutput` to the loaded review step (or the source step) so landing wiring is preserved.
- Update `buildReviewedIntentWorkflowSteps` tests for loader-sourced review agents/config and aggregated critic/actuator misses.

## Acceptance criteria

- [ ] A one-pass reviewed intent build returns a review step whose `agents.critic`/`agents.actuator` and `agentModelConfig` come from `loadWorkflowSteps`, with `stepId: "review"`, the `intent.prompt.review` prompt, the `.jarvis-intent-review-verdict.md` verdict path, and `maxCycles` equal to the review-pass count.
- [ ] When configured, the returned review step still carries `deferredIntentOutput` (write step's `intentOutput`, staging dir, invocation id, base ref) for post-review landing.
- [ ] A machine profile missing `critic`/`actuator` bindings makes the build return `{ ok: false }` whose error aggregates the missing `(stepId, role, agent)` bindings, instead of a single-role runtime throw.
- [ ] `intent-workflow-steps.test.ts` `reviewPasses` guard, `reviewPasses: 0` split-only delegation, and default-to-1 tests stay green (review composition unchanged by the rewiring).
- [ ] The builder no longer calls `loadMachineConfig`/`loadMachineProfileModels`/`resolveInvocationBindings` directly for the review step.

## Documentation updates

- `v2/docs/workflow-runner.md`: update the `buildReviewedIntentWorkflowSteps` (`intent-reviewed`) description to state the review step's agents/model config load through `loadWorkflowSteps` and that binding misses aggregate at load.
