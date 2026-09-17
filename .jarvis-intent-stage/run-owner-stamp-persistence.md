---
name: run-owner-stamp-persistence
---

# State store stamps run ownership on re-admission and guards stale-owner settlement

Seed: `v2/spec/seeds/run-admission-stamps-its-owner.md` (evidence: run `64b09d5d`, 2026-09-17).

## Problem

`runs.owner_identity` is written only at insert (`v2/src/persistence/state-store.ts:1850`); pipelines re-claim ownership (`state-store.ts:2231-2238`), runs do not. A settlement from a non-owner daemon also silently overwrites a terminal status another generation wrote.

## Decisions

- The state-store transition that makes a run non-terminal (resume/recovery admission) sets `owner_identity` to the admitting daemon in the same transaction. Rules out ownership fixed at first insert.
- The stamp never replaces a live different owner: the transition refuses via the existing claim refusal and leaves `owner_identity` unchanged.
- Chosen stale-owner behavior: a settlement from a daemon that is not the row's owner does not overwrite a terminal status already on the row; it is dropped and a run-log entry records the rejected transition (status, reporting identity). Silent overwrite is ruled out.
- Reconciliation still reads the named owner as authoritative; reading logic is unchanged.

## Acceptance criteria

- [ ] A state-store test asserts the re-admission transition stamps the admitting identity; it fails against the insert-only stamp.
- [ ] A state-store test asserts re-admission refuses when a different live owner holds the row, leaving `owner_identity` unchanged.
- [ ] A state-store test pins that a non-owner settlement on an already-terminal row leaves the status unchanged and appends the run-log entry.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` § Daemon retirement on supersession — run ownership stamping and stale-owner settlement rule.

## Prerequisites
