---
name: operator-serial-failure-confirmation-docs
---

# Operator docs document live serial confirmation

## Problem

Operator practices and the runbook do not name the live-surface serial confirmation command agents and hand recovery should use after a scoped failure, so operators fall back to bare `bun test` and hit frozen `v1/`.

## Behavior

Document when to run `bun run test:confirm:live` (after a scoped `test:*` or ready step fails, before treating the failure as real or chasing flakes): aggregate live roster serially, not the failing scoped slice; frozen `v1/` must not be used for confirmation.

## Acceptance criteria

- [ ] `v2/docs/operator-practices.md` names `bun run test:confirm:live` and states it excludes frozen `v1/`.
- [ ] `v2/docs/operator-runbook.md` names `bun run test:confirm:live` in the manual recovery / gate-failure workflow and states it excludes frozen `v1/`.
- [ ] `bun run lint:md` passes on the touched doc paths.

## Documentation updates

- `v2/docs/operator-practices.md`
- `v2/docs/operator-runbook.md`

## Prerequisites

- `package.json` exposes `test:confirm:live` with no discovery under frozen `v1/`.
- Agent repo guidance directs scoped-failure serial confirmation to `bun run test:confirm:live` instead of bare `bun test`.
