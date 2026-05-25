# 01 - Expose the public state-store API

With bootstrap and schema in place, define the narrow public repository surface
that Phase 1 actually promises. This slice owns the durable store types and the
operations `createRun`, `recordStepStart`, `commitStepBoundary`,
`loadRunForResume`, and `listStepHistory`, plus the open/init entry that
returns that repository surface. This slice sets the typed contracts and the
normal non-replay path. Final recovery semantics and duplicate-commit proof stay
for the next slice. SQL-shaped callers and raw handles stay internal.

## Decisions

- One public construction boundary: callers open the store and receive only the
  named repository methods.
- Public contracts are keyed by `runId`, `stepId`, `attemptId`, and
  `attemptOrdinal`, not row IDs or SQL details.
- `createRun` owns durable run identity, initial lifecycle state,
  `nextStepId`, and minimal work-pointer/checkpoint payload.
- `recordStepStart` is the only public allocator of a new `attemptOrdinal` for
  one `runId + stepId`.
- `commitStepBoundary` is the only public path that may durably complete an
  attempt, persist an outcome row, and advance `runs.next_step_id`.
- Read outputs stay narrow: resume snapshot and deterministic step history for
  one run, not generic queries.
- Public construction can expose one store object or repository value, but not
  raw Bun SQLite handles, migration entrypoints, or caller-managed transaction
  control.
- If this slice makes a cross-file public contract more concrete than the
  current durable docs, the owning update belongs in `v2/docs/v2-architecture.md`
  here.

## Task checklist

- Add the public Phase 1 store types and repository interface under `v2/src`.
- Implement `createRun`, `recordStepStart`, `commitStepBoundary`,
  `loadRunForResume`, and `listStepHistory` on top of the Phase 1 schema.
- Make creation-time, step-start, and boundary-commit inputs explicit in typed
  contracts.
- Keep migrations, SQL text, row mappers, raw DB access, and transaction
  orchestration internal.
- Doc-comment every exported API symbol.

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
      one previously started attempt and one boundary advance, and returns a
      typed boundary snapshot rather than raw row data. The public contract does
      not expose caller-managed transactions or raw SQL handles.
- [ ] `loadRunForResume` returns a typed recovery snapshot shape that is
      sufficient for the Phase 1 recovery outcomes and does not leak internal
      row shapes. The exact replay/terminal proof obligations stay in the next
      subspec.
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
- Put any newly concrete cross-file API semantics in
  `v2/docs/v2-architecture.md` in this subspec.
- Do not add a parallel store design doc.
