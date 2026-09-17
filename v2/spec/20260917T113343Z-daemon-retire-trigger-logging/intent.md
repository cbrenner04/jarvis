---
name: daemon-retire-trigger-logging
---

# Every daemon retire/drain/exit path logs its trigger

Seed: `v2/spec/seeds/daemon-survives-committed-successor-death.md`. On 2026-09-17 a committed successor exited silently via the drain-exit path (`v2/src/daemon/daemon.ts:313`, `:1356-1360`, `:1557`); nothing named what told it to retire.

## Decisions

- Every retire/drain/exit path writes a daemon-log line naming its trigger (RPC name and caller, or signal) before acting.
- No behavior change beyond logging.

## Acceptance criteria

- [ ] A test asserts `supersede`/`changeover`/`shutdown` and signal-driven retire each write a daemon-log line naming the trigger before exiting; it fails against the current code.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — trigger logging.

## Prerequisites
