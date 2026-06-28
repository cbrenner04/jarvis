# 00 — Migrate daemon start/list tests to handler factory

`v2/src/daemon-start-list.test.ts` reimplements daemon run-control handlers in
`beforeEach`, including separate active-run state, simplified errors, and
`setTimeout`-based settlement. Replace those local handler copies with
`createRunControlHandlers` wired through `startIpcServer` over injected fakes.
Keep the IPC-level assertions; make background run completion deterministic so
teardown cannot hang on live work.

## Decisions

- `daemon-start-list.test.ts` calls `createRunControlHandlers` and passes its handlers to `startIpcServer` — rules out inline `RpcHandler` copies for `start`/`list`/`pause`/`resume`/`kill`.
- The fake `writeLoopExecutor` is fixture-controlled and settles explicitly — rules out `setTimeout` as the run-settlement mechanism.
- `afterEach` drains or aborts in-flight fake executor work before closing IPC/state — rules out teardown depending on background promises outliving the server.
- No sibling test migration in this slice — rules out broadening beyond the only file currently carrying run-control handler copies.

## Tasks

- Import the exported handler factory and remove local run-control handler implementations from `daemon-start-list.test.ts`.
- Add a deterministic fake write-loop executor fixture that records calls and exposes explicit settle/abort control.
- Update teardown to finish or abort any in-flight fake executor work before closing the IPC server and state store.
- Keep existing IPC assertions pointed at the in-process server.

## Acceptance criteria

- [ ] `daemon-start-list.test.ts` wires `startIpcServer` with `createRunControlHandlers` over injected `stateStore` and `writeLoopExecutor`.
- [ ] `daemon-start-list.test.ts` has no inline `RpcHandler` implementations for `start`/`list`/`pause`/`resume`/`kill`.
- [ ] Background runs in `daemon-start-list.test.ts` settle under fixture control; no `setTimeout`-based settlement remains.
- [ ] `afterEach` waits for or aborts any in-flight fake write-loop executor work before server/state teardown.
- [ ] `daemon-start-list.test.ts` stays green.
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- No durable docs change: production behavior, IPC wire semantics, and exported symbol contracts are unchanged.
