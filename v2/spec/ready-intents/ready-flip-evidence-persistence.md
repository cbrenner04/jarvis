---
name: ready-flip-evidence-persistence
---

# Persist harness ready-flip evidence on run rows

## Problem

Republication must tell a harness-flipped open PR from an operator-flipped one, but no durable run-row field records that this lane's completion path successfully ran `gh pr ready`.

## Behavior

After a successful harness ready flip, the state store records on the flipping run row: PR number, branch, base ref, and flip time. Failed flips write nothing. A lineage read for the same spec/lane (any prior row) returns the newest matching evidence for a given branch, base ref, and PR number, or nothing when no row recorded that triple.

## Acceptance criteria

- [ ] `state-store.test.ts` fails against the pre-fix schema and pins write-after-success, no write when `gh pr ready` does not succeed, lineage hit across an older row on the same lane, and miss when branch, base, number, or lineage differ.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/state-store.md` — ready-flip evidence fields and lineage lookup contract.

## Prerequisites
