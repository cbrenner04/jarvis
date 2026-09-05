# Inject daemon write-loop binding dependencies

`writeLoopBindingSourceDeps` and its `set/resetWriteLoopBindingSourceDepsForTests` pair are module-level mutable globals in production `daemon.ts`; tests are the only writers. Replace them with constructor/argument injection on the daemon-owned write-loop binding-resolution path and re-point daemon and execution tests at explicit seams.

## Decisions

- Export `WriteLoopBindingSourceDeps` and thread it through `RunControlHandlerDeps`, `DaemonStartupDeps`, and an optional second argument to `resolveWriteLoopBindings`; rules out a module-level mutable `writeLoopBindingSourceDeps` let.
- Refactor `runWithWriteLoopMachineConfigPath` to merge `machineConfigPath` into per-call deps without mutating module state; rules out a global-scoped wrapper that assigns the let.
- Delete `setWriteLoopBindingSourceDepsForTests` and `resetWriteLoopBindingSourceDepsForTests`; rules out retaining `ForTests` exports on the production path.
- Keep binding resolution on the existing daemon-owned `resolveWriteLoopBindings` path; rules out moving resolution into execution-loop callers.
- Production injection fields use neutral names (`forceSnapshotAgentModelConfig`, `bindingSpawn`, `codexSessionsDir`); rules out `*ForTest` identifiers on production deps types or fields.
- Documentation updates: none — internal test-seam refactor with no operator-facing behavior change.

## Tasks

- Export `WriteLoopBindingSourceDeps` from `daemon.ts`; add optional `writeLoopBindingSourceDeps` to `RunControlHandlerDeps` and `DaemonStartupDeps`.
- Change `resolveWriteLoopBindings(input, deps?)` to read binding-source fields from `deps` (default `{}`); thread handler/startup deps through every internal `resolveWriteLoopBindings` call site in `daemon.ts`.
- Refactor `runWithWriteLoopMachineConfigPath` to merge `machineConfigPath` into deps for the scoped callback; update `cli.ts` to pass merged deps into `resolveWriteLoopBindings`.
- Remove the module let and delete `setWriteLoopBindingSourceDepsForTests` / `resetWriteLoopBindingSourceDepsForTests`.
- Rewrite `write-loop-binding-source-guard.test.ts` and `write-loop-codex-sandbox-mode.test.ts` to pass deps as the second `resolveWriteLoopBindings` argument (no setter imports or `afterEach` resets).
- Rewrite daemon tests that call the setters (`daemon-workflow-start.test.ts`, `daemon-wait-run-completion.test.ts`, `daemon-state-store-lock-timeout.test.ts`, `daemon-start-list.test.ts`, `daemon-resume.test.ts`, `daemon-reconciliation.test.ts`, `daemon-queue-promotion.test.ts`) to pass `writeLoopBindingSourceDeps` through `createRunControlHandlers` / `startDaemonRuntime` / `promoteQueuedRunImpl` call sites instead.
- Change `workflow-runner.test-support.ts` to return injectable binding-source deps (e.g. `workflowRunnerResumeProfileDeps()`) instead of calling a setter; update `workflow-runner-resume.test.ts` and `workflow-runner-review.test.ts` to spread those deps into `createRunControlHandlers` and drop `resetWriteLoopBindingSourceDepsForTests` cleanup.

## Acceptance criteria

- [x] On main before this change, `daemon.ts` exports `setWriteLoopBindingSourceDepsForTests` and `resetWriteLoopBindingSourceDepsForTests`.
- [x] `daemon.ts` exports neither `setWriteLoopBindingSourceDepsForTests` nor `resetWriteLoopBindingSourceDepsForTests`.
- [x] `daemon.ts` defines no module-level `writeLoopBindingSourceDeps` let.
- [x] `cli.ts` imports no `setWriteLoopBindingSourceDepsForTests` or `resetWriteLoopBindingSourceDepsForTests` symbols from `daemon.ts`.
- [x] `write-loop-binding-source-guard.test.ts` stays green with injection-only `resolveWriteLoopBindings` setup (no `setWriteLoopBindingSourceDepsForTests`).
- [x] `write-loop-codex-sandbox-mode.test.ts` stays green with injection-only `resolveWriteLoopBindings` setup (no `setWriteLoopBindingSourceDepsForTests`).
- [x] `daemon-workflow-start.test.ts` stays green.
- [x] `daemon-wait-run-completion.test.ts` stays green.
- [x] `daemon-state-store-lock-timeout.test.ts` stays green.
- [x] `daemon-start-list.test.ts` stays green.
- [x] `daemon-resume.test.ts` stays green.
- [x] `daemon-reconciliation.test.ts` stays green.
- [x] `daemon-queue-promotion.test.ts` stays green.
- [x] `workflow-runner.test-support.ts` imports no setter symbols from `daemon.ts` and exposes injectable binding-source deps for resume-profile setup.
- [x] `workflow-runner-resume.test.ts` stays green.
- [x] `workflow-runner-review.test.ts` stays green.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

- None — no operator-facing behavior change.
