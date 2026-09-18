---
name: daemon-changeover-rebind-test-flakes-under-load
---

# Daemon-changeover rebind tests wait on events, not wall-clock deadlines

Unsplit rationale: the fix is confined to one test file (`v2/src/daemon/daemon-changeover.sandbox-unrunnable.test.ts`); no production or shared-helper surface changes.

## Prerequisites

## Primary implementation surface

- `v2/src/daemon/daemon-changeover.sandbox-unrunnable.test.ts`

## Problem

`a committed handoff watch retries a rebind bind failure and eventually rebinds` (`:877`, #4022) and `a committed handoff reclaims the leftover socket and rebinds after a real successor process is killed` fail under `test:integration:v2` load / CI and pass in isolation. `waitFor(..., 3_000)` (`:61`, `:897`) is a private wall-clock deadline that measures machine load, not behavior. Same shape as `v2/spec/completed/20260909T042005Z-wal-handshake-has-no-private-deadline`.

## Decisions

- Replace the private deadline with a wait on the observable event (successful rebind / health answer), bounded only by the test's suite timeout (`15_000`). Raising the number is ruled out.
- Prefer an event signal (e.g. resolve a promise when injected `bind` succeeds on the retry public bind) over polling where the seam allows.
- Audit sibling `waitFor(..., N_000)` calls in the file: fix those gating a pass/fail verdict on wall-clock (reclaim-after-successor-kill confirmed); keep ones asserting a negative within a window.
- Test-only; no daemon behavior change; no `*ForTest` production seams.

## Acceptance criteria

- [ ] The rebind test has no private wall-clock deadline shorter than its suite timeout; it waits on the rebind event.
- [ ] The reclaim-after-successor-kill test and any other verdict-gating sibling `waitFor` have no private deadline shorter than the suite timeout.
- [ ] The rebind test still fails if the committed watch never retries after the injected bind failure.
- [ ] The file passes 5 consecutive times under `bun run test:integration:v2` concurrency.
- [ ] `bun run typecheck`, `bun run test:v2` and `bun run test:integration:v2` pass.

## Documentation updates

- None expected; if the audit changes a shared test-helper convention, note it in `v2/docs/operator-practices.md` flake guidance.
