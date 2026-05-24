# 02 - Add the transactional state-store API

Once the schema exists, later v2 phases need a narrow library API instead of ad
hoc SQL access. This slice defines the repository-style operations the rest of
v2 will call, how those operations compose transactionally at step boundaries,
and the round-trip coverage that proves the store can persist and read Phase 1
state without a daemon in the loop.

## Decisions

- Bias the API toward named state transitions, not a generic ORM wrapper or
  query builder.
- Keep the contract at the workflow boundary the next phases need: create a
  run, record attempt start, commit a completed step boundary, load a run for
  resume, and list attempt history.
- Make step-boundary completion one transactional repository operation that
  persists attempt finish, persists outcome data, and advances the durable
  checkpoint together.
- Keep test scope library-local: bootstrap, round-trip persistence, and
  transactional reads and writes against a temp database.
- Keep SQL details, row mappers, and migration helpers internal.

## Task Checklist

- Define the public Phase 1 state-store API surface under `v2/`.
- Define which operations are transactional boundaries and which writes stay
  internal.
- Define round-trip test cases for create, resume, and history reads.
- Define what remains internal.

## Phase 1 repository API contract

Public API is a narrow repository surface with named workflow-boundary
operations. Phase 1 exports these operations only:

1. `createRun(input) -> { runId, createdAt, nextStepId }`
2. `recordStepStart(input) -> { attemptId, attemptOrdinal, startedAt }`
3. `commitStepBoundary(input) -> { attemptId, finishedAt, nextStepId, outcomeId }`
4. `loadRunForResume(input) -> { run, latestAttemptsByStep, latestOutcomeByAttempt }`
5. `listStepHistory(input) -> { attempts[] with joined outcomes }`

No generic query surface is exported.

## Identifiers and operation I/O

- `createRun` accepts caller-stable identifiers and workflow pointers needed by
  later phases: `{ runId, projectId, workflowName, specPath, worktreePath, branch, initialStepId }`.
  It returns `{ runId, createdAt, nextStepId }`.
- `recordStepStart` accepts `{ runId, stepId, startedAt }`. It creates the next
  monotonic `attemptOrdinal` for `(runId, stepId)` and returns
  `{ attemptId, attemptOrdinal, startedAt }`.
- `commitStepBoundary` accepts `{ runId, attemptId, stepId, terminalStatus, outcomeClass, nextStepId, finishedAt }`.
  It returns `{ attemptId, finishedAt, nextStepId, outcomeId }`.
- `loadRunForResume` accepts `{ runId }` and returns enough durable state for
  runner/daemon resume without SQL knowledge: run row plus latest attempt/outcome
  snapshots keyed by stable IDs.
- `listStepHistory` accepts `{ runId, stepId }` and returns attempt history
  ordered by `attemptOrdinal`, each row carrying its durable outcome fields.

## Transaction boundary

- `commitStepBoundary` is the only public write path allowed to persist attempt
  completion and checkpoint advancement.
- Inside one DB transaction it must:
  1. mark the targeted attempt finished and terminal,
  2. insert/update the attempt outcome row,
  3. update `runs.next_step_id` (or terminal run status when no next step),
  4. commit atomically or roll back all changes.
- No public operation may expose partial writes for these fields.

## Required Phase 1 round-trip coverage

Library-local tests run against a temporary SQLite file and verify:

1. bootstrap and forward-only migrations run idempotently before operations,
2. `createRun` persists and can be reloaded by `loadRunForResume`,
3. repeated `recordStepStart` calls produce monotonic per-step attempt ordinals,
4. `commitStepBoundary` writes attempt completion + outcome + checkpoint in one
   atomic transaction,
5. `listStepHistory` returns persisted attempts/outcomes in stable ordinal order,
6. recovery-oriented reads (`loadRunForResume`) return the latest durable
   checkpoint and attempt/outcome state after committed boundaries.

## Internal-only surfaces

The following stay internal and are not public v2 contracts:

- SQL text, statement builders, and row mappers.
- Migration planner/executor helpers and bootstrap wiring internals.
- Raw `Database` handle exposure for arbitrary caller SQL.
- Any alternate-backend adapter seam or daemon-singleton-owned store wrapper.

## Acceptance criteria

- [ ] `v2/src` exports exactly `createRun`, `recordStepStart`,
      `commitStepBoundary`, `loadRunForResume`, and `listStepHistory` with the
      I/O shapes in "Identifiers and operation I/O"; no generic query/exec
      surface or raw `Database` handle is exported.
- [ ] `commitStepBoundary` performs attempt-finish + outcome write + checkpoint
      advance in one transaction; a test forcing a failure mid-operation asserts
      all three roll back (no partial write).
- [ ] `recordStepStart` assigns monotonic `attemptOrdinal` per `(runId, stepId)`;
      a test calling it repeatedly asserts 1, 2, 3…
- [ ] `loadRunForResume` and `listStepHistory` round-trip durable state by stable
      IDs after `createRun`/`commitStepBoundary`; tests assert the returned
      shapes need no SQL knowledge from callers.
- [ ] SQL text, row mappers, and migration helpers are not exported from the
      package barrel; a test or the barrel asserts only the five ops, bootstrap,
      and types are public.
- [ ] `bun run typecheck` and `bun test` pass.

## Documentation updates

- Update `v2/docs/v2-architecture.md` so the persistence section lists the
  initial repository-style state-store operations later daemon and runner code
  are expected to call, without introducing a generic query layer.
