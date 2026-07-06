# Consolidate state-store types into one module

`state-store-types.ts` duplicates types already owned by `state-store.ts`
(`AttemptStatus`, `OutcomeKind`, `Run`, `Attempt`, `StateStore`) and carries
stale drift (`AttemptStatus` variants, `StateStore` signatures, unused
`Outcome`). Survivors (`RunStatus`, `RUN_STATUSES`, `isRunStatus`,
`OnReviseConfig`, `WorkflowSnapshot`, `WorkflowSnapshotStep`) move into
`state-store.ts`; importers repath; the types file is deleted. Behavior
unchanged.

## Prerequisites

- v2 lean documentation-standard and in-process daemon-test defaults are
  landed (seed 01)

## Out of scope

- `v2/docs/v1-behaviors.md` (behavior-preserving; no catalog change).
- `v2/docs/state-store.md` (does not name `state-store-types.ts`).
- New persistence/execution imports beyond today's type-only edges.
- Doc-comment churn on moved symbols (lean inline standard applies; move only).

## Decisions

- Delete stale duplicate types and the stale `StateStore` interface from
  `state-store-types.ts` — rules out keeping drifted parallel definitions.
- Colocate survivors in `state-store.ts` — rules out a third types module or
  barrel re-export layer.
- Keep the canonical `OutcomeKind` already in `state-store.ts` — rules out
  retaining the duplicate in `state-store-types.ts`.
- Delete `state-store-types.ts` after migration — rules out leaving an empty
  or partial stub file.
- Persistence→execution imports stay `import type` only — rules out new runtime
  coupling across the boundary.
- `daemon-wire.ts` keeps its existing value-import of `isRunStatus` from
  persistence (host→persistence, not persistence→execution) — rules out
  extracting `isRunStatus` or converting that edge to `import type` on
  consolidation grounds.

## Task checklist

- [ ] Move `RUN_STATUSES`, `RunStatus`, `isRunStatus`, `OnReviseConfig`,
      `WorkflowSnapshot`, and `WorkflowSnapshotStep` from
      `state-store-types.ts` into `state-store.ts` (drop the self-import).
- [ ] Repath every `state-store-types` importer under `v2/src/` to
      `state-store.ts` (grep `state-store-types` and `persistence/` path
      patterns): `log-stream.ts`, `write-loop.ts`, `workflow-runner.ts`,
      `run-operator-error.ts`, `daemon.ts`, `daemon-wire.ts`, and co-located
      tests that type-import from the old module.
- [ ] Delete `state-store-types.ts` after survivors are moved and importers
      repathed.
- [ ] Update `v2/docs/v2-architecture.md` **Source layout** persistence row
      to drop `state-store-types.ts`.
- [ ] `bun run typecheck`, `bun run test:v2`, `bun run test:integration:v2`.

## Acceptance criteria

- [ ] `state-store.test.ts` stays green.
- [ ] `log-stream.test.ts` stays green.
- [ ] `daemon-wire.test.ts` stays green.
- [ ] `write-loop.test.ts` stays green.
- [ ] `workflow-runner.test.ts` stays green.
- [ ] `daemon-revise.test.ts` stays green.
- [ ] `daemon-wait-run-completion.test.ts` stays green.
- [ ] `run-operator-error.test.ts` stays green.
- [ ] `v2/src/persistence/state-store-types.ts` is absent and `rg
      state-store-types v2/src` finds no matches.
- [ ] `v2/docs/v2-architecture.md` **Source layout** persistence row lists
      only `log-stream.ts`, `log-stream.test.ts`,
      `log-stream.sandbox-unrunnable.test.ts`, `state-store.ts`, and
      `state-store.test.ts`.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/v2-architecture.md` — drop `state-store-types.ts` from the
  persistence domain map.
