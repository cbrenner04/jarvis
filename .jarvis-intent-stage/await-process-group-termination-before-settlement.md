---
name: await-process-group-termination-before-settlement
---

# Await process-group termination before subprocess settlement

## Prerequisites

## Module-boundary surface

- Shared subprocess execution: group-mode termination in `shared/subprocess.ts`.

## Problem

Group-mode timeout and abort signal SIGTERM, reject immediately, and leave an unreferenced SIGKILL timer behind. An owning process can exit during the grace period, canceling escalation while a SIGTERM-resistant child survives.

## Behavior

- A `processGroup` timeout or abort keeps SIGTERM→SIGKILL escalation live, confirms the negative process-group id no longer exists, and only then settles the call.
- Every `processGroup` caller inherits the same termination guarantee without call-site reaping.
- Existing group-mode success, error classification, output capture, and abort signaling remain pinned.

## Decision ledger

- Make group death part of `runAsync` settlement instead of a best-effort post-settlement timer; rules out callers returning while descendants remain alive.
- Keep the escalation timer referenced through the grace period instead of calling `unref()`; rules out owner exit canceling SIGKILL.
- Confirm disappearance with a negative-PGID signal-zero probe after escalation instead of treating signal delivery as termination; rules out SIGTERM-resistant members being reported dead.
- Apply the contract in shared group mode instead of individual verifier or gate callers; rules out inconsistent cleanup across mutation tests, ready gates, required integration, and future group-mode consumers.
- Preserve the existing abort-path contract under `shared/subprocess.test.ts`; rules out weakening live run-kill behavior while repairing timeout cleanup.

## Acceptance criteria

- [ ] `shared/subprocess.test.ts` spawns a group-mode child that ignores SIGTERM and spins, drives `timeoutMs`, and proves `process.kill(-pgid, 0)` throws `ESRCH` when the returned promise rejects; the test fails against the pre-fix implementation.
- [ ] `shared/subprocess.test.ts` proves the timeout promise remains unsettled until group disappearance is confirmed; the test fails against the pre-fix immediate rejection.
- [ ] A subprocess-owner regression exits immediately after its group-mode timeout and proves no member of the recorded group survives; it fails against the pre-fix unreferenced escalation.
- [ ] Existing group-mode abort tests in `shared/subprocess.test.ts` stay green.
- [ ] `bun run typecheck`, `bun run test:v2`, `bun run test:integration:v2`, and `bun run test:shared` pass.

## Documentation updates

- `v2/docs/v2-architecture.md` — define group-mode settlement as awaited, escalated, and confirmed termination for timeout and abort.
- `v2/docs/v1-behaviors.md` — record the strengthened shared process-group termination contract and its effect on existing group-mode consumers.
