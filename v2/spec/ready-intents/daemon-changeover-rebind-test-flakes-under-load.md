---
name: daemon-changeover-rebind-test-flakes-under-load
---

# Daemon-changeover rebind tests wait on events, not wall-clock deadlines

Unsplit rationale: the fix is confined to one test file (`v2/src/daemon/daemon-changeover.sandbox-unrunnable.test.ts`); no production or shared-helper surface changes.

## Prerequisites

## Primary implementation surface

- `v2/src/daemon/daemon-changeover.sandbox-unrunnable.test.ts`

## Problem

`a committed handoff watch retries a rebind bind failure and eventually rebinds` (`:877`, #4022) and `a committed handoff reclaims the leftover socket and rebinds after a real successor process is killed` (`:832`) fail under `test:integration:v2` load / CI and pass in isolation. Their positive `waitFor(..., N_000)` calls (`:844`, `:849`, `:858`, `:897`; helper defined at `:61`) are private wall-clock deadlines that measure machine load, not behavior. Same shape as `v2/spec/completed/20260909T042005Z-wal-handshake-has-no-private-deadline`.

## Decisions

- Scope: every positive `waitFor` inside the two named tests (`:844`, `:849`, `:858`, `:897`), plus `:928` (`publicBindCount() >= 3`, slow-successor test). All other `waitFor` calls in the file are out of scope, including negative-window ones such as `:509` `rolledBackEarly`.
- Mechanism: add a test-local unbounded poll helper (no deadline argument) for the in-scope calls, so the test's suite timeout is the only deadline. Do not raise the numbers or use a bound equal to or near the suite timeout.
- For the rebind test, wait on an event instead of polling: resolve a promise when the injected `bind` succeeds on the retry public bind (`publicBinds >= 3`), then assert health.
- Test-only; no daemon behavior change; no `*ForTest` production seams.

## Acceptance criteria

- [ ] The in-scope `waitFor` calls (`:844`, `:849`, `:858`, `:897`, `:928`) have no private deadline; the suite timeout is the only deadline, and the rebind test waits on the retry-bind event.
- [ ] The rebind test fails when the injected `bind` always throws on public binds after the first (the watch can never rebind), by timing out at the suite timeout rather than passing vacuously.
- [ ] `for i in 1 2 3 4 5; do bun test v2/src/daemon/daemon-changeover.sandbox-unrunnable.test.ts || break; done` passes 5 consecutive times while `bun run test:integration:v2` runs concurrently in another shell.
- [ ] `bun run typecheck`, `bun run test:v2` and `bun run test:integration:v2` pass.

## Documentation updates

- None (test-only).
