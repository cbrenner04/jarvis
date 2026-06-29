# 01 — IPC tail inherits cross-process wake

Daemon IPC log tail (`v2/src/daemon.ts` `tailStreamHandler`) drives
`logReader.follow`. Prove that path delivers live appends to a detached IPC
client when a separate process writes to the shared log storage — no parallel
poll loop in IPC or daemon.

Depends on [00](./00-cross-process-follow-wake.md).

## Prerequisites

- [00](./00-cross-process-follow-wake.md) complete — cross-process `follow` wake on shared storage.
- Exported tail-stream handler factory from `daemon.ts` exists (`v2/spec/ready-intents/daemon-tail-stream-handler-factory.md` landed) — `startDaemon` and tests share one handler body with `loadRun` gating and `follow` pump.

## Decisions

- IPC tail keeps using exported factory → `logReader.follow(runId, signal)` as the sole live-append path — rules out duplicating wake or poll logic in `daemon.ts` or `v2/src/ipc/`.
- Cross-process proof wires the exported tail handler factory with injected `stateStore` and `logReader` fakes on a real IPC server plus detached client; writer appends from a separate process on the shared log path — rules out inline `StreamHandler` copies or in-process-only tail live-append tests as sufficient.
- Unknown-run tail rejection and client `stream-end` abort behavior unchanged — rules out revisiting daemon tail gating in this slice.
- Deferred to first consumer: full detached-daemon end-to-end smoke — pin when `v2-daemon-minimal-integration-smoke` or CLI tail needs it; this slice proves the factory-backed `follow` IPC path only.

## Task checklist

- Add agent-runnable tests wiring the exported tail handler factory with injected fakes: unknown-run rejection (`loadRun` miss closes without data) and client `stream-end` aborts the server-side `follow` pump.
- Add `ipc.sandbox-unrunnable.test.ts` (or equivalent): factory-backed tail handler on shared log storage, detached IPC client opens tail stream, separate writer process appends, client receives `stream-data` frames in ascending `seq` order.
- Do not add daemon-local wake/poll beyond what `follow` provides.

## Acceptance criteria

- [ ] While an IPC client holds an open tail stream, records appended for that `runId` from a separate process on shared storage arrive as `stream-data` frames in ascending `seq` order (`ipc.sandbox-unrunnable.test.ts`; verify with `bun run test:integration:v2`).
- [ ] Each live record arrives as its own `stream-data` frame (not batched).
- [ ] Factory-backed agent-runnable test for unknown-run tail rejection stays green (`loadRun` miss → immediate `stream-end`, no `stream-data`).
- [ ] Factory-backed agent-runnable test for client `stream-end` aborting the server-side `follow` pump stays green.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- No change — cross-process wake and IPC inheritance are documented in 00's `v2/docs/v2-architecture.md` update.
