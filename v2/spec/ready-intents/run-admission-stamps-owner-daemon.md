---
name: run-admission-stamps-owner-daemon
---

# Daemon resume and automatic recovery stamp the admitting daemon as run owner

Seed: `v2/spec/seeds/run-admission-stamps-its-owner.md` (evidence: run `64b09d5d` settled `killed`/`daemon_restart` by successor 91733 while 5930 still drained it).

## Decisions

- `jarvis run resume` admission and automatic recovery route through the owner-stamping re-admission transition with the current daemon's identity.
- Refused admission (different live owner) surfaces the existing claim refusal to the caller.
- Successor reconciliation stays owner-authoritative; with the correct owner named, draining-ownership protection (#3893) covers resumed runs.

## Acceptance criteria

- [ ] A daemon test drives dispatch on generation A, handoff to B with the run paused, `run resume` on B, then handoff to C, and asserts C leaves the run live and owned by B (no `run_reconciled`); it fails against the insert-only stamp.
- [ ] A daemon test asserts automatic recovery stamps the recovering daemon's identity.
- [ ] A daemon test asserts `run resume` is refused when a different live daemon owns the row, with `owner_identity` unchanged.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` § Daemon retirement on supersession — resume/recovery re-stamp ownership.
- `v2/docs/operator-runbook.md` — remove any gotcha about resumed runs reconciled as orphans after handoff.
- `v2/docs/v1-behaviors.md` — only if it catalogs run ownership.

## Prerequisites

- State-store re-admission transition stamps the admitting daemon as run owner and refuses a live different owner.
- Non-owner settlement does not overwrite a terminal run status and records the rejected transition in the run log.
