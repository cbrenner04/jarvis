---
name: detach-admission-refuses-without-a-run-row
---

# Detach admission prints only reachable run ids

## Problem

`jarvis run workflow implement … --detach` printed a run id and exited `0` for a run whose row never existed (`run wait` → `unknown_run`).

## Decisions

- The daemon relays a runner named refusal to the CLI; the CLI prints the refusal and exits non-zero instead of a run id.
- Exit 0 from `--detach` means a persisted row exists for the printed id.

## Acceptance criteria

- [ ] A test proves implement admission whose routing dispatches no step returns a named refusal and a non-zero exit instead of printing a run id.
- [ ] A test proves every id printed by `--detach` resolves through `run wait`.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — detach exit-0 contract and the no-dispatch refusal.

## Prerequisites

- Linked implement routing that dispatches no step returns a named refusal and never reports an unpersisted run id.
