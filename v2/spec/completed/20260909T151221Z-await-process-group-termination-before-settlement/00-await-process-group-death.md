# Await process-group death before settlement

## Problem

Group-mode timeout can reject immediately after SIGTERM, and timeout or abort leaves SIGKILL escalation on an unreferenced timer. The owner can therefore return or exit before a SIGTERM-resistant group member dies. Make process-group death part of shared subprocess settlement while preserving group-mode results and output.

## Decisions

- Implement the guarantee in `shared/subprocess.ts` group mode; rules out caller-specific reaping that leaves current or future group-mode consumers inconsistent.
- Keep the existing 50 ms SIGTERM grace on a referenced timer; rules out owner exit canceling escalation and changing the established delay.
- After SIGKILL, probe `process.kill(-pgid, 0)` every 10 ms without a confirmation deadline until `ESRCH`; rules out a bounded retry that settles without proof of group death.
- Treat every non-`ESRCH` probe failure, including `EPERM`, as unconfirmed and continue polling; rules out treating inability to inspect the group as disappearance.
- Preserve the trigger's existing settlement result after confirmed group death: timeout remains `AsyncSubprocessError` code `ETIMEDOUT`, while abort retains direct-child-close classification and captured output; rules out a generic termination error.
- Leave natural group-mode close outside the termination lifecycle; rules out killing surviving members after success or non-zero exit.
- Keep non-group subprocess settlement unchanged; rules out imposing process-group probing or referenced escalation on direct-child callers.
- Deferred to first consumer: which cause wins when abort and timeout both fire — pin when a caller passes both.
- Make `v2/docs/v2-architecture.md` the canonical escalation and confirmation record, keep `v2/docs/v1-behaviors.md` as a consumer-parity cross-link, and keep `shared/subprocess.ts` to its symbol contract; rules out duplicating mechanism details across durable homes.

## Task checklist

- Refactor group-mode timeout and abort onto one awaited SIGTERM-to-SIGKILL lifecycle that retains its referenced escalation timer and settles only after group disappearance is confirmed.
- Probe negative PGIDs every 10 ms after SIGKILL until `ESRCH`, retaining the call indefinitely on `EPERM` or any other probe error.
- Retain the timeout/abort cause, child-close result, output buffers, listener cleanup, and timer cleanup until the awaited lifecycle completes.
- Add readiness handshakes before timeout or abort in resistant-process fixtures, then cover timeout and abort settlement ordering, probe errors, and an owner that exits immediately after timeout rejection.
- Pin natural group-mode success and non-zero close as non-terminating, plus abort classification and captured output.
- Update each durable documentation home per below without duplicating the lifecycle mechanism.

## Acceptance criteria

- [x] `shared/subprocess.test.ts` uses a readiness handshake before `timeoutMs` against a group with a SIGTERM-resistant spinning member and proves timeout rejection occurs only after `process.kill(-pgid, 0)` throws `ESRCH`; the test fails against the pre-fix immediate timeout rejection.
- [x] `shared/subprocess.test.ts` proves that timeout promise remains unsettled through the 50 ms SIGTERM grace and settles only after confirmed disappearance; the test fails against the pre-fix immediate timeout rejection.
- [x] `shared/subprocess.test.ts` uses a controllable group probe to prove 10 ms polling continues through `EPERM` and other non-`ESRCH` probe errors without a confirmation deadline, and settles only on a later `ESRCH`; the test fails against the pre-fix implementation.
- [x] `shared/subprocess.test.ts` uses a readiness handshake before aborting a group whose leader writes `stdout` and `stderr`, then exits on SIGTERM while a member ignores SIGTERM and spins; settlement occurs only after `process.kill(-pgid, 0)` throws `ESRCH` and retains `AsyncSubprocessError` `status`, `code`, `stdout`, and `stderr` from direct-child close; the test fails against the pre-fix direct-child-close settlement.
- [x] `shared/subprocess.test.ts` launches a separate subprocess owner that exits immediately after its group-mode timeout rejects and proves no member of the recorded group survives owner exit; the test fails against the pre-fix unreferenced escalation.
- [x] `shared/subprocess.test.ts` proves natural group-mode success and non-zero close leave a deliberately surviving member alive for fixture cleanup, without group probing or termination; the test fails if natural close starts reaping the group.
- [x] Existing `shared/subprocess.test.ts` group-mode abort tests stay green.
- [x] `shared/subprocess.ts` documents only the non-obvious `processGroup` symbol contract: timeout and abort await confirmed disappearance, while `onGroupId` supports owner-crash recovery.
- [x] `v2/docs/v2-architecture.md` is the canonical record of referenced SIGTERM-to-SIGKILL escalation, 10 ms `ESRCH` confirmation, and durable reaping as the owner-crash fallback.
- [x] `v2/docs/v1-behaviors.md` records the strengthened contract inherited by ready gates, required integration, mutation verification, and future consumers, cross-linking the canonical architecture record without repeating the mechanism.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.
- [x] `bun run test:shared` passes.
- [x] `bun run test:integration:shared` passes.

## Documentation updates

- `shared/subprocess.ts` — document the `processGroup` symbol contract and crash-only `onGroupId` recovery role.
- `v2/docs/v2-architecture.md` — canonical lifecycle: referenced escalation, 10 ms `ESRCH` confirmation without deadline, and crash recovery boundary.
- `v2/docs/v1-behaviors.md` — consumer parity record cross-linking the architecture lifecycle.
