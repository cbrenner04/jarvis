# Inject CLI workflow attach-wait dependencies

`v2/src/commands/workflow.ts` carries `forceSkipAttachClientWaitForTest` and `attachWaitRunIdOverrideForTest` module lets with exported `set*ForTest` setters on the production `runWorkflowCommand` path; `workflow.test.ts` is the only writer. Replace them with optional fields on the existing `CliDeps` argument so attach-wait guard-inversion cases mutate per-invocation deps instead of module state.

## Decisions

- Attach-wait overrides are optional `CliDeps` fields `forceSkipAttachClientWait?: boolean` and `attachWaitRunIdOverride?: string` read inside `startWorkflowRun`; rules out module-level mutable lets on the production workflow command path.
- Unset override fields preserve today's production defaults: `skipClientWait = detach || deps.forceSkipAttachClientWait` and client `wait` targets `deps.attachWaitRunIdOverride ?? start.runId`; rules out attach/detach operator semantics changes.
- Guard-inversion cases spread injected overrides into the `deps` passed to `main`/`runWorkflowCommand`; rules out exported `setForceSkipAttachClientWaitForTest` / `setAttachWaitRunIdOverrideForTest` setters.
- Attach-wait guard falsification (especially run-ID retargeting) needs per-invocation override values at `main()` call time; rules out converting these two inversion cases to source comment-checkpoint mutation (the detach guard pattern).
- No `pipeline.ts` edits in this subspec.
- Documentation updates: none — internal test-seam move with no operator-facing behavior change.

## Tasks

- Add optional `forceSkipAttachClientWait?: boolean` and `attachWaitRunIdOverride?: string` to `CliDeps` in `v2/src/cli/deps.ts` (follow existing injectable-field comment style; no `*ForTest` identifiers).
- Thread `deps` into `startWorkflowRun` and replace reads of the module lets with `deps.forceSkipAttachClientWait` / `deps.attachWaitRunIdOverride` defaulting to current production behavior.
- Delete `forceSkipAttachClientWaitForTest`, `attachWaitRunIdOverrideForTest`, and their exported setters from `workflow.ts`.
- Update `workflow.test.ts`: drop setter imports and the `afterEach` setter resets; change `expectAttachedWorkflowMissesEntryTerminalContract` to accept deps override injection instead of a setter `mutate` callback; spread override fields through `attachedEntryWaitWorkflowDeps`; rewrite attach-wait guard-inversion cases to inject overrides through `deps`.

## Acceptance criteria

- [x] On main before this change, `v2/src/commands/workflow.test.ts` imports and calls `setForceSkipAttachClientWaitForTest` / `setAttachWaitRunIdOverrideForTest` from `workflow.ts`.
- [x] `v2/src/commands/workflow.ts` defines neither `forceSkipAttachClientWaitForTest` nor `attachWaitRunIdOverrideForTest` and exports neither `setForceSkipAttachClientWaitForTest` nor `setAttachWaitRunIdOverrideForTest`.
- [x] `v2/src/commands/workflow.test.ts` imports no setter symbols from `workflow.ts`.
- [x] `workflow.test.ts` — `run workflow implement with --detach admits and exits without client wait` stays green.
- [x] `workflow.test.ts` — `attached run workflow waits through a multi-step workflow until the entry run is terminal` stays green.
- [x] `workflow.test.ts` — `inverting attach client-wait guard fails attached run workflow waits through a multi-step workflow until the entry run is terminal` stays green using injected deps only.
- [x] `workflow.test.ts` — `retargeting attach client wait at a constituent run ID fails attached run workflow waits through a multi-step workflow until the entry run is terminal` stays green using injected deps only.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

- None — no operator-facing behavior change; attach/detach semantics remain documented in existing workflow docs.
