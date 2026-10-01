---
name: finalization-ready-gates-share-the-gate-slot
---

# Finalization ready gates share the one-per-daemon gate slot

## Problem

The one-gate-per-daemon slot (`MAX_CONCURRENT_AGENT_GATE_INVOCATIONS = 1`) covers only agent-invoked `bun run test:*` inside write iterations. Harness-run finalization gates (`bun run ready`, required integration, ready-gate repair re-gates, terminal-publication gates) take no lease, so N lanes publishing together run N full suites at once. Under that load per-file 30s test timeouts fire in files outside every lane's diff, the pooled serial retry also fails, and every lane settles `ready_gate_failed` on correct work.

## Evidence

- 2026-10-01, ~6 implement lanes publishing at once (load avg ~20): every finalization gate failed `ready_gate_failed` on per-file timeouts in `cleanup.test.ts`, `ready-finalize.test.ts`, `workflow-runner-publication.test.ts`, `workflow.test.ts`, `completion-commit.test.ts` — none in any lane's diff; each passes alone. Runs `ed378400-3705-4e32-bc10-ff7f45a5012e` (plan-draft-shape-contract-reprompt), `621a823b-913d-49c3-8139-21d51fd980b1` (fan-out durable-outcomes lane).
- Lease: in-process `Set` with synchronous acquire-or-refuse (`write-loop.ts:679-727`); its only acquirer is the agent shell-command tracker (`write-loop.ts:753`); the re-drive reads it (`daemon-slot-redrive.ts:67-68`).
- Finalization spawns with no lease: `createDefaultRunReadyGate` (`ready-finalize.ts:1354-1386`), `createDefaultRunRequiredIntegration` (`ready-finalize.ts:1394-1419`), invoked from `createReadyFinalizer` (`ready-finalize.ts:1472, :1486`) via `runReadyFinalizer` (`write-loop.ts:4827`, `:5008`); repair re-gates loop through `publishCompletionArtifacts` (`write-loop.ts:4247`, `:4293-4298`, `MAX_READY_GATE_REPAIRS = 3`); terminal publication calls `deps.runReadyGate` directly (`terminal-publication.ts:148`).
- The only other cross-run serializer is `VerifierTestRunSemaphore` (`diff-derived-mutation-verifier.ts:373`), scoped to mutation-verifier test runs.
- `operator-runbook.md` § Concurrency ("One concurrent full-suite gate invocation per daemon process") reads as covering all gates; it does not.

## Decisions

- Move the lease to its own module `v2/src/execution/gate-invocation-lease.ts` (acquire, release, count, release subscription, `gateInvocationAdmits`) so it is testable outside `write-loop.test.ts`; `write-loop.ts` and `daemon-slot-redrive.ts` import it. No behavior change for agent gates.
- Add a waiting acquire: `awaitGateInvocationLease({ signal, timeoutMs })` resolves with a lease in FIFO order as releases free the slot. Agent gates keep refuse-on-contention (`slot_contention` + re-drive); harness gates wait. Rules out refusing finalization — it has no re-drive and would strand a done lane.
- Every harness-run full-suite gate holds the lease for its spawn and releases in `finally`: default ready gate, required integration, terminal-publication gate. Each repair re-gate re-acquires (released while the repair agent runs, so other lanes progress). Base-ref probes and mutation/smoke verifiers stay outside the slot (scoped `bun test <path>` runs; mutation has its own semaphore).
- Wait is bounded by `readyGateSubprocessTimeoutMs()` and aborted by the run signal; wait time does not consume the gate's own deadline (armed at spawn). Expiry throws `ReadyGateError` with `timedOut: true` and output naming the slot wait, so existing settlement applies. Rules out a new failure kind.
- Operator-visible wait: log `ready_gate_slot_wait` (`gate`, `waitedMs`) when the acquire did not resolve immediately; `jarvis run list` `message` shows `waiting for gate slot` while queued.
- Agent gate starts during a held finalization lease refuse `slot_contention` and are re-driven on release (existing path); no change.

## Acceptance criteria

- [ ] `v2/src/execution/gate-invocation-lease.test.ts`: two concurrent `awaitGateInvocationLease` calls resolve in FIFO order, the second only after the first releases; an aborted waiter rejects and leaves the queue intact; a waiter exceeding `timeoutMs` rejects; fails against a refuse-only lease.
- [ ] `v2/src/execution/ready-finalize.test.ts`: two concurrent `createReadyFinalizer` runs over a stubbed `asyncSubprocessRunner` never overlap their gate spawns (max in-flight 1); required integration holds the lease too; a held agent lease delays the finalization gate until released; fails against current main.
- [ ] `v2/src/execution/ready-finalize.test.ts`: slot-wait expiry surfaces `ReadyGateError` with `timedOut: true` naming the slot wait.
- [ ] `v2/src/execution/terminal-publication.test.ts`: the terminal-publication ready gate acquires and releases the lease, including on a red gate.
- [ ] `v2/src/daemon/daemon-slot-redrive.test.ts`: a finalization-lease release fires the `slot_contention` re-drive.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Concurrency — slot covers harness finalization gates; finalization waits, agents refuse; `ready_gate_slot_wait`; `waiting for gate slot`.
- `v2/docs/write-behavior.md` — finalization gate serialization and repair re-acquire.
- `v2/docs/v1-behaviors.md` — record.
