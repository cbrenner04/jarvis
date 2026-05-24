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

## Acceptance criteria

- [ ] The subspec defines a repository-style API surface with named operations
      equivalent to create-run, record-step-start, commit-step-boundary,
      load-run-for-resume, and list-step-history.
- [ ] The subspec does not introduce a generic ORM facade, arbitrary query API,
      alternate-backend seam, or daemon-coupled singleton object.
- [ ] The subspec defines `commit-step-boundary` or an equivalent single public
      write path as the only operation allowed to persist attempt completion and
      checkpoint advancement, so callers cannot split that durable effect across
      ad hoc writes.
- [ ] The subspec states which identifiers each public operation accepts and
      returns so later runner and daemon code do not need hidden SQL knowledge
      to address runs, steps, or attempts.
- [ ] The subspec requires focused round-trip tests that prove schema bootstrap,
      persisted run creation, persisted attempt history, and recovery-oriented
      reads against a temporary database.
- [ ] The subspec keeps library visibility tight by identifying what SQL or
      helper surfaces stay internal rather than becoming public v2 contracts.

## Documentation updates

- Update `v2/docs/v2-architecture.md` so the persistence section lists the
  initial repository-style state-store operations later daemon and runner code
  are expected to call, without introducing a generic query layer.
