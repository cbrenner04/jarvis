# Test scaffolding helpers

## Problem

Daemon pipeline tests lie about write-step shape with `as unknown as AnyWorkflowStep` and synchronize with bare `while (!flag) { await Promise.resolve(); }` loops. Production stamp paths now dereference fields such as `worktree.projectName`, so partial stubs fail at runtime instead of compile time (#3060). Unbounded microtask spins starve the event loop when the waited-on condition never becomes true, so per-test timeouts never fire and the file hangs with no output (#3060).

## Surface

`v2/src/testing/workflow-step-fixtures.ts`, new `v2/src/testing/bounded-microtask-spin.ts`, `v2/src/testing/bounded-microtask-spin.test.ts`, `v2/src/testing/workflow-step-fixtures.test.ts`.

## Decisions

- Add `createMinimalDispatchWriteStep` to `workflow-step-fixtures.ts` returning `WriteWorkflowStep & { stageIndex?: number; branchKey?: string }` (assignable to `AnyWorkflowStep` without a cast) with defaults for dispatch-only daemon pipeline tests; keep `writeStepFixtures().createWriteStep` for binding/worktree-heavy cases; rules out a parallel stub module or per-file partial stubs such as `STUB_STEP_WORKTREE`, `taggedStep`, and `okStep`.
- Factory defaults mirror `createWriteStep` minus `createBinding`, temp-root side effects, and `withExternalWorktree`: `behavior: "write"`, stub `worktree` (`projectRoot`, `projectName`, `branchName`, `baseRef`, `jarvisRoot` matching `STUB_STEP_WORKTREE` in `pipeline-execution.test.ts` today), `specPath`, `stepRules`, `expectedArtifactPath`, `role`, `agents`, `agentModelConfig: DEFAULT_AGENT_MODEL_CONFIG`, `stepId`; uniform stub `worktree` on every default even when a call site does not stamp; rules out per-path thinner stubs.
- Factory accepts overrides for dispatch-test fields (`stepId`, `stageIndex`, `branchKey`, `worktree`, `workflowInvocationId`, landing metadata, etc.) without requiring `createBinding` or temp roots; rules out forcing every dispatch stub through `writeStepFixtures()`.
- Export `spinUntilMicrotask` from `bounded-microtask-spin.ts` with default iteration cap **10_000**, optional per-call override, and a caller-supplied condition label included in the thrown error when the cap is exhausted; rules out unbounded `Promise.resolve()` yield loops and rules out rewriting deadline-bound `setImmediate`/`setTimeout` polls.
- No production code changes; rules out dispatch-timing or stamp-surface edits.

## Task checklist

- Export `createMinimalDispatchWriteStep` from `workflow-step-fixtures.ts` with the minimal defaults above.
- Add `bounded-microtask-spin.ts` exporting `spinUntilMicrotask` and `bounded-microtask-spin.test.ts` covering a never-true condition.
- Add `workflow-step-fixtures.test.ts` proving the minimal factory assigns to `AnyWorkflowStep` without a cast, exposes `worktree.projectName`, and accepts `stageIndex` / `branchKey` overrides without ad-hoc casts.

## Acceptance criteria

- [ ] `bounded-microtask-spin.test.ts` proves a spin whose flag never sets throws the helper's named error instead of hanging; it fails against the pre-fix bare `while (!flag) { await Promise.resolve(); }` loop reachable in `pipeline-stage-dispatch.test.ts` today.
- [ ] `workflow-step-fixtures.test.ts` assigns `createMinimalDispatchWriteStep(...)` to `AnyWorkflowStep` without a cast, asserts `step.worktree.projectName` is defined, and sets `stageIndex` / `branchKey` via overrides without casts; it fails against the pre-fix `{ behavior: "write" } as unknown as AnyWorkflowStep` pattern in `pipeline-stage-dispatch.test.ts` today.
- [ ] `bun run typecheck` passes.

## Documentation updates

None — `v2/docs/test-writing.md` lands in subspec 08.
