---
name: v2-dead-weight-purge
---

# Dead weight purge

Pure deletion: code with zero production references, one drifted duplicate type file, one duplicate test suite, one placeholder code path. No refactors, no replacements, no new helpers.

## Decisions

- **Delete files:** `v2/src/tui/tui-field-collector.tsx` + its test (zero consumers; a future TUI workflow launcher rebuilds it when real); `v2/test/fixtures/complexity-violation.ts` and `shared-import-violation.ts` (zero references; adjust the fixtures README if it names them).
- **Delete symbols:** `DaemonRunRejectedError` (daemon.ts — never thrown or caught), `FrameDecoder.reset()` (ipc/codec.ts — no callers).
- **state-store-types.ts:** delete the stale half (~lines 56–167): second `AttemptStatus` (already drifted from state-store.ts), second `OutcomeKind`/`Run`/`Attempt`, unused `Outcome`, and the stale `StateStore` interface whose signatures no longer match the real store. Move survivors (`RunStatus`, `isRunStatus`, `OnReviseConfig`, `WorkflowSnapshot`/`WorkflowSnapshotStep`, one `OutcomeKind`) into `state-store.ts` and delete the file. Type-only imports keep the persistence/execution boundary intact.
- **De-export:** drop `export` where a symbol has no reference outside its file; delete the symbol outright if unused internally too. List: cli.ts `Io` · agent-model-config `EXECUTABLE_ROLES`, `ExecutableRole` · daemon-lifecycle `DaemonMetadata`, `probeSocket` · daemon-wire `DaemonWorkflowStepStatus`, `DaemonWorkflowStepTerminalOutcome`, `DaemonWorkflowStepSnapshot` · daemon.ts `WorktreeOwnership`, `ActiveRun` · run-operator-error `RUN_OPERATOR_ERROR_REASONS`, `RUN_OPERATOR_NEXT_ACTIONS` · external-worktree `ensureExternalWorktree`, `acquireExternalWorktreeLock`, `releaseExternalWorktreeLock` · review-debate `ReviewDebateCycleOutcome`, `ReviewDebateResult` · step-runner `StepOutcomeToken`, `StepRunInput` · workflow-loader `LoadWorkflowStepsDeps` · workflow-runner `WorkflowTelemetryContext`, `ReviewDebateStepAgents`, `validateOnReviseTargets` · write-loop-input `DEFAULT_WRITE_STEP_RULES` · write-loop `WRITE_LOOP_OUTCOME_KINDS` · write.ts `WriteExecuteResult` · ipc/types `RequestFrame`, `StreamOpenFrame` · log-stream `IterationStartedEvent`, `BoundaryCommittedEvent`, `AppendWakeFactory` · testing/bindings `SimulatedOutcome` · tui `TuiDaemonHealthResult`, `TuiDaemonStatusResult`, `TuiDaemonStartResult`, `TuiDaemonRpcTransport`. **Exempt:** `WorkflowPresetName` and preset machinery (seed 07 consumes them).
- **resume placeholder → explicit rejection** (daemon.ts:888-904): the paused-run resume path rebuilds `WriteLoopInput` with empty `stepRules`/`expectedArtifactPath`/`bindings` and would fail `no_binding` at first invocation. Replace with a `not_implemented`-style operator error in the existing run-operator-error family. Real resume lands after seed 08 (bindings become reconstructable from role + machine profile).
- **Delete duplicate tests:** the `ipc.test.ts` tail-stream block (~lines 159–323 including its helpers) — scenario-for-scenario duplicate of `daemon-tail-stream.test.ts`, which is the superset.
- **Docs:** update `v2-architecture.md` domain map for the removed files; `state-store.md` if it names `state-store-types.ts`.

## Out of scope

- Workflow preset machinery.
- Any behavior change beyond the resume rejection; any new abstractions or helpers.

## Verification

`bun run typecheck`, `test:v2`, `test:integration:v2`. PR body lists every dropped test with the surviving test that owns its behavior (baseline: 481 registrations / 544 run cases).

## Ordering

02 — after 01, before 03.
