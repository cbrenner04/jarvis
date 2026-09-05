---
name: notification-delivery-cursor-is-exclusive
---

# `notifications wait --since <deliveryCursor>` re-delivers the incident at that cursor forever

## Problem

`jarvis notifications wait` prints `{ incident, deliveryCursor }` and the operator docs say to "use `deliveryCursor` as the next `--since` to chain waits without gaps". Passing that exact cursor back returns **the same incident again**, immediately, with the same `deliveryCursor` — the bound is inclusive, so the chain never advances. A wake loop built on the documented protocol spins on one incident instead of blocking for the next.

Observed 2026-09-06 while driving seven concurrent jarvis lanes. A chaining wake script looped ten times in ~25 minutes, each iteration returning `run:3b48be2c-d48f-4205-af8e-659c044d6c81 terminal:completed` and cursor `1788534511688:run:3b48be2c…:terminal:completed`, while three pipelines crossed approval gates and four implements ran unobserved. `jarvis notifications list --since "$cursor"` has the same inclusive bound: it returns 193 incidents whose **first** row is the incident at the cursor.

This makes the documented primary wake path for backgrounded work unusable, which matters more than a normal display bug: the runbook explicitly steers operators away from `run list` / `pipeline list` polling and onto this primitive.

## Decisions

- `--since <deliveryCursor>` is **exclusive**: the incident that produced the cursor is never re-delivered by `wait` or `list`; rules out the current inclusive comparison that makes chaining a fixed point.
- Duration and timestamp forms of `--since` keep their current inclusive-of-window semantics; only the delivery-cursor form is exclusive, because only it names one already-delivered incident; rules out changing all three forms together.
- `wait` with a cursor equal to the newest owed incident blocks for the next one rather than returning immediately; rules out a fast-return that reads as "nothing is happening".

## Acceptance criteria

- [ ] A test proves `notification_wait` with `since` set to an incident's own delivery cursor does not return that incident; fails against the current inclusive bound.
- [ ] A test proves two chained waits over three owed incidents return the second and third, never repeating the first.
- [ ] A test proves `notification_list --since <deliveryCursor>` excludes the incident at that cursor while duration and timestamp `--since` forms are unchanged.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — cursor wire form and the exclusive bound.
- `v2/docs/operator-runbook.md` — chaining example that actually advances.
