---
name: non-durable-review-status-rollup
---

# Non-durable review steps do not make successful workflows look killed

Reviewed plan workflows complete their write and review work but daemon `wait`/`list` report `runStatus: killed` because the review step intentionally has no durable run row.

## Behavior

- A finished workflow skips authored steps classified as non-durable when rolling durable rows into the entry run's status.
- A reviewed plan whose durable steps completed reports `completed`, while an absent row for an authored durable step still reports `killed`.
- Existing durable step rows still propagate their first non-`completed` status.
- Snapshots created before durability metadata treat every authored step as durable, preserving their existing rollup behavior.

## Decisions

- Record step durability in the workflow snapshot and make runner and rollup share that classification; rules out behavior-name skip lists that drift when durability changes.
- Keep ordinary plan review non-durable; rules out creating review rows solely to satisfy status reporting.
- Treat a missing row as `killed` only for a step classified as durable; rules out conflating intentional non-persistence with interrupted work.
- Default absent durability metadata to durable; rules out reclassifying or migrating existing snapshots.

## Out of scope

- Making generic review durable.
- Landing reviewed plan output stranded in staging.

## Documentation updates

- Update `v2/docs/workflow-runner.md` with step durability and rollup semantics.
- Remove only the false-`killed` diagnosis from `v2/docs/operator-runbook.md` Known gotchas; retain the separate reviewed-plan landing warning until fixed.
- Align the v2-only workflow status entry in `v2/docs/v1-behaviors.md`.

## Prerequisites
