# Write loop drops invert-for-test hooks

`write-loop.ts` threads `invert*ForTest` through `WriteLoopInput`, repair-fence helpers
(`invertFence` / `invertSidecarFence`), and `resolveIterationSettlementKind(role, invert)` so
guard-inversion tests pass without mutating real guards.

## Decisions

- Strip all four forbidden hook shapes from `write-loop.ts` — rules out retaining hooks,
  `invertFence` / `invertSidecarFence` parameter plumbing, or renaming to evade a future guard.
- `WriteLoopInput` and repair-fence helper signatures lose every `invert*ForTest` field and every
  `invert*` function parameter — rules out keeping `bypassPersistedReadyGateRepairFenceForTest`-style
  siblings in the same edit (not an `invert*` shape).
- Remove the `invert` parameter from `resolveIterationSettlementKind`; fix the real abort/watchdog
  mapping with no invert plumbing; make the helper module-private (single internal call site) — rules
  out a public `invert*` parameter surviving the hook sweep.
- Delete dedicated invert `test()` blocks; add `Mutation checkpoint:` comments on positive pinning
  tests — rules out tautological `{ invertReadyGateRepairSidecarFenceForTest: true }` loop calls.
- Highest-risk guard pin: ready-gate repair sidecar fence (`findFirstHarnessSidecarBasenameViolation`).

## Tasks

- **write-loop.ts:** remove `invertAbortWatchdogPrecedenceForTest`,
  `invertRepairAbortPropagationForTest`, `invertRepairJoinForTest`,
  `invertRepairTerminalBeforeJoinForTest`, `invertReadyGateRepairFenceForTest`, and
  `invertReadyGateRepairSidecarFenceForTest` from `WriteLoopInput` and call sites; drop
  `invertFence` / `invertSidecarFence` parameters from `findFirstHarnessSidecarBasenameViolation`,
  `findFirstRepairFenceViolation`, `validateReadyGateRepairCompletion`, and
  `enforcePersistedReadyGateRepairFence` (retain `bypass` only on the persisted-enforcement options
  bag); remove the `invert` parameter from `resolveIterationSettlementKind` and make it
  module-private.
- **write-loop.test.ts:** delete `inverting repair $label breaks held-repair settlement for killed`
  `test.each` block, `abort-vs-watchdog guard inversion: watchdog-first flips to progress when
  precedence is inverted`, and `abort-vs-watchdog precedence predicate: both truth directions, no
  real-timer wait`; remove unfenced repair-fence cases that pass `invertReadyGateRepairFenceForTest`
  / `invertReadyGateRepairSidecarFenceForTest`; add `Mutation checkpoint:` comments on positive
  pinning tests:
  - `joins a held ready repair before $terminal becomes durable` (`test.each` over
    completed/failed/killed) — mutations on abort-propagation, invocation-join, and terminal-ordering
    guards in `write-loop.ts`;
  - `rejects ready-gate repairs outside the run diff and spec tree` — mutation: remove
    `!allowedPaths.has(normalized)` rejection in `findFirstRepairFenceViolation`;
  - `rejects ready-gate repairs that would publish harness sidecars` — mutation: remove
    `basename(normalized).startsWith(".jarvis-")` rejection in
    `findFirstHarnessSidecarBasenameViolation`;
  - `lets an observed abort win before the watchdog, but not after it` (watchdog-first subcase
    settles `iteration_timeout`) — mutation: flip `resolveIterationSettlementKind` precedence
    mapping; preserve the deleted inversion block's race-ordering scope boundary (checkpoint
    inversion does not cover dropped watchdog latch, synchronous abort settlement, or reordered
    `Promise.race` operands).
- Run `bun run typecheck` and `bun test v2/src/execution/write-loop.test.ts`.

## Acceptance criteria

- [ ] `write-loop.ts` carries no `setInvert*ForTest` export, `invert*ForTest` module variable,
  `invert*` function parameter, or `invert*ForTest` type member.
- [ ] `write-loop.test.ts` — unfenced repair-fence cases that pass `invertReadyGateRepairFenceForTest:
  true` or `invertReadyGateRepairSidecarFenceForTest: true` are removed; `rejects ready-gate repairs
  that would publish harness sidecars` carries a `Mutation checkpoint:` comment naming the
  `findFirstHarnessSidecarBasenameViolation` mutation.
- [ ] In `write-loop.test.ts`, the documented `findFirstHarnessSidecarBasenameViolation` mutation
  turns `rejects ready-gate repairs that would publish harness sidecars` RED. (Manual)
- [ ] In `write-loop.test.ts`, the documented `resolveIterationSettlementKind` precedence mutation
  turns `lets an observed abort win before the watchdog, but not after it` RED. (Manual)
- [ ] `write-loop.test.ts` — `rejects ready-gate repairs that would publish harness sidecars` stays
  green.
- [ ] `write-loop.test.ts` — `rejects ready-gate repairs outside the run diff and spec tree` stays
  green.
- [ ] `write-loop.test.ts` — `joins a held ready repair before $terminal becomes durable` stays
  green.
- [ ] `write-loop.test.ts` — `lets an observed abort win before the watchdog, but not after it`
  stays green.

## Documentation updates

- None — `write-step-rules-forbid-production-invert-hooks` owns operator-facing guard-inversion doc.
