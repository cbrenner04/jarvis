# Settlement persists the observation

A `ready_gate_out_of_scope` row records only `readyGateOutsidePaths` and a detail string, so the exoneration cannot be audited without re-running tests.

## Decisions

- New persisted field `readyGateOutOfScopeObservations?: Record<string, { pass: number; fail: number; baseCommit: string }>`, keyed by path — a map rather than an array parallel to `readyGateOutsidePaths`, ruling out index-alignment drift between the two fields.
- `ReadyGateOutOfScopeLogFields` and `readyGateOutOfScopeLogFields` (`v2/src/execution/ready-finalize.ts`) gain this field, populated from `ReadyGateError.outsidePathObservations` (00), round-tripping through the plain-object source path the function already supports.
- The field is added to every local re-declaration of the sibling `readyGateOutsidePaths`/`readyGateOutOfScopeDetail` fields, since each is a separate settlement path that carries the same log fields onward: `LoopFinishedEvent` (`v2/src/persistence/log-stream.ts`), and the local shapes in `v2/src/execution/write-loop.ts`, `v2/src/execution/workflow-runner.ts`, and `RunOperatorError` in `v2/src/daemon/run-operator-error.ts`. Rows and events without the field stay readable (it is optional throughout).
- `formatReadyGateOutOfScopeDetail` keeps its existing prefix (`ready gate failing paths also reproduce on <baseRef>:` followed by a space) and its comma-joined path list; a path with a recorded observation gets a trailing parenthetical, `<path> (base <sha>: <pass> pass / <fail> fail)`, and a path with no observation is listed bare, unchanged from today.
- `outOfScopeSettlementResumable` keeps comparing `readyGateOutsidePaths` sets only; the observation is not part of the resumability comparison.

## Acceptance criteria

- [x] A new test in `v2/src/execution/write-loop.test.ts` settles a `ready_gate_out_of_scope` failure and asserts the persisted `loop_finished` row's `readyGateOutOfScopeObservations` carries, for each path, the pass/fail counts and verified base commit, and the detail string names them; it fails against the pre-fix code.
- [x] A new test in `v2/src/daemon/run-operator-error.test.ts` composes a `RunOperatorError` from a `ready_gate_out_of_scope` `loop_finished` event carrying `readyGateOutOfScopeObservations` and asserts the composed error carries the same observations; it fails against the pre-fix code.
- [x] A test asserts a `ready_gate_out_of_scope` settlement with no `readyGateOutOfScopeObservations` (a legacy row) still composes/renders without throwing, and its detail string lists the affected path with no parenthetical.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md`: the out-of-scope settlement records `readyGateOutOfScopeObservations` (per-path pass/fail counts and verified base commit) alongside `readyGateOutsidePaths`, and the detail string names each path's observation when one is recorded.
- `v2/docs/v1-behaviors.md`: rewrite the existing sentence that settlement is `ready_gate_out_of_scope` with `readyGateOutsidePaths` and base-ref detail "only" — it also records the per-path base-ref observation.
