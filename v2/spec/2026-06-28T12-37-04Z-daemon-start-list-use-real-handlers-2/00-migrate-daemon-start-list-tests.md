# 00 — Migrate daemon start/list tests to handler factory

`v2/src/daemon-start-list.test.ts` reimplements daemon run-control handlers in
`beforeEach`, including separate active-run state, simplified errors, and
`setTimeout`-based settlement. Replace those local handler copies with
`createRunControlHandlers` wired through `startIpcServer` over injected fakes.
Keep IPC coverage on the real handler path; correct any stale expectations that
match copied-test behavior instead of handler semantics. Make background run
completion deterministic so teardown cannot hang or leak async failures.

## Decisions

- `daemon-start-list.test.ts` calls `createRunControlHandlers` and passes its handlers to `startIpcServer` — rules out inline `RpcHandler` copies for `start`/`list`/`pause`/`resume`/`kill`.
- The fake `writeLoopExecutor` is fixture-controlled and settles explicitly — rules out `setTimeout` as the run-settlement mechanism.
- Teardown aborts settle fake executor promises without unhandled rejections — rules out replacing teardown hangs with fire-and-forget async failures.
- The fake executor exposes pause and abort signal observation — rules out losing coverage that handlers trigger injected run-control signals.
- No sibling test migration in this slice — rules out broadening beyond the only file currently carrying run-control handler copies.

## Tasks

- Import the exported handler factory and remove local run-control handler implementations from `daemon-start-list.test.ts`.
- Add a deterministic fake write-loop executor fixture that records calls, exposes explicit settle/abort control, and reports pause/abort signal state.
- Update migrated assertions to match real `createRunControlHandlers` results and errors.
- Preserve pause and kill tests that verify the handler triggers the injected pause and abort signals.
- Update teardown to finish or abort any in-flight fake executor work before closing the IPC server and state store, with no unhandled rejections.
- Keep IPC assertions pointed at the in-process server.

## Acceptance criteria

- [x] `daemon-start-list.test.ts` wires `startIpcServer` with `createRunControlHandlers` over injected `stateStore` and `writeLoopExecutor`.
- [x] `daemon-start-list.test.ts` has no inline `RpcHandler` implementations for `start`/`list`/`pause`/`resume`/`kill`.
- [x] Migrated IPC assertions expect real `createRunControlHandlers` behavior, correcting any copied-handler expectations that diverge.
- [x] Background runs in `daemon-start-list.test.ts` settle under fixture control; no `setTimeout`-based settlement remains.
- [x] Teardown aborts any in-flight fake write-loop executor work and settles it without unhandled rejections before server/state teardown.
- [x] Pause and kill tests assert the injected fake executor observed the pause signal and abort signal respectively.
- [x] `daemon-start-list.test.ts` stays green.
- [x] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- No durable docs change: production behavior, IPC wire semantics, and exported symbol contracts are unchanged.
