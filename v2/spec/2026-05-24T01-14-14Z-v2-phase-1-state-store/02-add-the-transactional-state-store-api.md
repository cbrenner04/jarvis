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
  run, record attempt start, record attempt finish with outcome data, advance a
  durable checkpoint, load a run for resume, and list attempt history.
- Make boundary updates transactional so later phases can reason about
  checkpoint advancement as a single durable effect.
- Keep test scope library-local: schema bootstrap, round-trip persistence, and
  transactional reads/writes against a temp database.
- Avoid speculative reads for future UIs or analytics; Phase 1 only exposes the
  operations later daemon and runner code concretely need.

## Task Checklist

- Define the public Phase 1 state-store API surface under `v2/`.
- Define which operations are single-transaction boundaries.
- Define round-trip test cases for create/load/history behavior.
- Define what remains internal helper or SQL detail rather than public API.

## Acceptance criteria

- [ ] The subspec defines a repository-style API surface with named operations
      equivalent to create-run, record-step-start, record-step-finish,
      advance-checkpoint, load-run-for-resume, and list-step-history.
- [ ] The subspec does not introduce a generic ORM facade, arbitrary query API,
      alternate-backend seam, or daemon-coupled singleton object.
- [ ] The subspec defines which write operations must commit transactionally so
      later phases can treat a completed boundary as one durable state change.
- [ ] The subspec requires focused round-trip tests that prove schema bootstrap,
      persisted run creation, persisted attempt history, and recovery-oriented
      reads against a temporary database.
- [ ] The subspec keeps library visibility tight by identifying what SQL or
      helper surfaces stay internal rather than becoming public v2 contracts.

## Documentation updates

- Add or update one Phase 1-focused `v2/docs/` reference that lists the initial
  state-store operations later daemon and runner code are expected to call.
