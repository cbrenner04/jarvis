# 01 - Expose the public state-store API

With bootstrap and schema in place, define the narrow public repository surface
that Phase 1 actually promises. This slice owns the durable store types and the
named operations `createRun`, `recordStepStart`, `commitStepBoundary`,
`loadRunForResume`, and `listStepHistory`, plus the open/init entry that returns
that repository surface. Keep SQL-shaped callers, raw handles, migration
entrypoints, and ad hoc query helpers internal.

## Decisions

- Keep one public store-construction boundary: caller opens the store and
  receives only the named repository methods, not a Bun SQLite handle or
  transaction primitive.
- Public contracts are identifier-driven. Inputs/outputs are keyed by durable
  `runId`, `stepId`, `attemptId`, and monotonic `attemptOrdinal`, not row IDs or
  SQL addressing details.
- `createRun` owns durable run identity, lifecycle start state, initial
  `nextStepId`, and minimal work pointers/checkpoint payload.
- `recordStepStart` is the only public path that allocates a new
  `attemptOrdinal` for a given `runId + stepId`.
- `commitStepBoundary` is the only public path that may durably complete an
  attempt, persist an outcome row, and advance `runs.next_step_id`.
- Keep read outputs explicit and narrow: durable run snapshots for resume and
  step history snapshots for one run, not generic filters or raw row bags.
- Keep terminal-run encoding consistent with the durable contract:
  `run-terminal` is reached when `runs.status` is terminal and
  `runs.next_step_id` is absent after a committed terminal boundary.

## Task checklist

- Add the public Phase 1 store types and repository interface under `v2/src`.
- Implement `createRun`, `recordStepStart`, `commitStepBoundary`,
  `loadRunForResume`, and `listStepHistory` on top of the Phase 1 schema.
- Make creation-time, step-start, and boundary-commit inputs explicit in typed
  contracts.
- Keep internal-only helpers private: migrations, SQL text, row mappers, raw DB
  access, and transaction orchestration.
- Doc-comment every exported symbol added by the store API surface.

## Acceptance criteria

- [ ] Phase 1 exposes one public open/init entry plus only these repository
      methods: `createRun`, `recordStepStart`, `commitStepBoundary`,
      `loadRunForResume`, and `listStepHistory`.
- [ ] `createRun` accepts the durable run/work pointer payload needed by Phase 1
      and persists the initial checkpoint/lifecycle state, returning a typed
      snapshot keyed by `runId` with `createdAt` and initial `nextStepId`.
- [ ] `recordStepStart` accepts `runId` and `stepId`, allocates exactly one new
      monotonic `attemptOrdinal` for that run-step pair, persists attempt start
      state, and returns a typed attempt snapshot including `attemptId`,
      `attemptOrdinal`, and `startedAt`.
- [ ] `commitStepBoundary` accepts enough identity to bind the write to exactly
      one previously started attempt and one boundary advance, without exposing
      caller-managed transactions or raw SQL handles.
- [ ] `loadRunForResume` returns a typed recovery snapshot that is sufficient for
      the Phase 1 recovery outcomes and does not leak internal row shapes.
- [ ] `listStepHistory` returns typed attempt/outcome history for one run in a
      deterministic order keyed by durable IDs and ordinals; it does not become
      a generic query surface.
- [ ] Raw Bun SQLite handles, migration runners, SQL helpers, row mappers, and
      ad hoc query APIs remain internal and are not exported Phase 1 contracts.
- [ ] Every exported store symbol added in this slice has an inline doc-comment
      stating purpose, params, returns, errors, and invariants.
- [ ] If implementing this slice makes public semantics more concrete than the
      current durable docs, update `v2/docs/v2-architecture.md` in the same
      subspec and touch `v2/docs/v2-build-order.md` or `v2/spec/v2-meta-index.md`
      only if their wording becomes inaccurate.

## Documentation updates

- Keep single-symbol contracts inline.
- Put any newly concrete cross-file API semantics in `v2/docs/v2-architecture.md`
  in this subspec; do not add a parallel store design doc.
