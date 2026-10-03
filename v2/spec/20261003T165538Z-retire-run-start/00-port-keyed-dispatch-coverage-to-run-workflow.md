# Port keyed dispatch coverage to `run workflow`

## Primary implementation surface

- `v2/src/commands/workflow.test.ts`
- `v2/src/commands/run.test.ts` (delete ported cases only in subspec 01, not here)

## Problem

`v2/src/commands/run.test.ts` `describe("keyed daemon auto-start on dispatch")` and `run start dispatches without a preceding status request` under `describe("dispatch to keyed daemons")` exercise `withConnectDispatch` via `fx.runStartArgs`. Workflow admission must carry the same keyed auto-start and single-request dispatch shape on `run workflow` argv before subspec 01 removes `run start`.

## Decisions

- Mirror all five cases in `run.test.ts` `describe("keyed daemon auto-start on dispatch")` on workflow argv — rules out a single happy-path port.
- Port `run start dispatches without a preceding status request` to a workflow test asserting one IPC request and no antecedent `list`/`status` — rules out leaving that shape on `run start` until subspec 01.
- Leave `read-only run list reports the missing daemon` in `run.test.ts` — rules out duplicating read-only auto-start negation under workflow tests.
- Do not delete `run start` tests here — rules out dropping coverage before workflow parity exists.
- Test-only subspec: exempt from spec-guidance failing-test-on-runtime-change; baseline-red AC below pins the new describe absent on merge base.

## Task checklist

- Share keyed socket / `withFixedUuid` helpers with `run.test.ts` patterns where workflow admission needs stable request ids.
- Assert IPC method `start` with workflow `params.steps` (reachable on main in `daemon-run-lifecycle-handlers.ts` ~897–907); assert `params.input` is absent in dispatch mocks — rules out treating workflow admission as `WriteLoopInput`/`params.input` direct-write start.
- Keep `bun test v2/src/commands/workflow.test.ts` green with both old and new tests present.

## Acceptance criteria

- [x] On merge base, `bun test v2/src/commands/workflow.test.ts -t 'keyed daemon auto-start on dispatch'` fails because the describe is absent; after the port the same filter passes.
- [x] `v2/src/commands/workflow.test.ts` includes a `keyed daemon auto-start on dispatch` describe (or equivalent) mirroring the five mutating-dispatch cases in `run.test.ts` `describe("keyed daemon auto-start on dispatch")` reachable via `fx.runStartArgs`.
- [x] `v2/src/commands/workflow.test.ts` includes a workflow-argv case mirroring `run start dispatches without a preceding status request` from `run.test.ts` `describe("dispatch to keyed daemons")`.
- [x] `run.test.ts` `describe("keyed daemon auto-start on dispatch")` and the ported `dispatch to keyed daemons` `run start` case stay green until subspec 01 removes them.
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- None (test-only subspec).
