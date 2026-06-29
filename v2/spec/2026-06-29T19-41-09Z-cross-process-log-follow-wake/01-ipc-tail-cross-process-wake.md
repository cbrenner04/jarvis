# 01 — IPC tail inherits cross-process wake

Daemon IPC log tail (`v2/src/daemon.ts` `tailStreamHandler`) already drives
`logReader.follow`. Prove that path delivers live appends to a detached IPC
client when a separate process writes to the shared log storage — no parallel
poll loop in IPC or daemon.

Depends on [00](./00-cross-process-follow-wake.md).

## Decisions

- IPC tail keeps using `logReader.follow(runId, signal)` as the sole live-append path — rules out duplicating wake or poll logic in `daemon.ts` or `v2/src/ipc/`.
- Cross-process proof uses a real IPC server plus detached client; writer appends from a separate process on the shared log path — rules out in-process-only tail live-append tests as sufficient for this slice.
- Unknown-run tail rejection and `stream-end` abort behavior unchanged — rules out revisiting daemon tail gating in this slice.
- Deferred to first consumer: full detached-daemon end-to-end smoke — pin when `v2-daemon-minimal-integration-smoke` or CLI tail needs it; this slice proves the `follow`-backed IPC path only.

## Task checklist

- Add sandbox-unrunnable IPC test: server hosts tail handler on shared log storage, detached client opens tail stream, separate writer process appends, client receives `stream-data` frames in `seq` order.
- Do not add daemon-local wake/poll beyond what `follow` provides.

## Acceptance criteria

- [ ] While an IPC client holds an open tail stream, records appended for that `runId` from a separate process on shared storage arrive as `stream-data` frames in ascending `seq` order (`ipc.sandbox-unrunnable.test.ts` or equivalent).
- [ ] Each live record still arrives as its own `stream-data` frame (not batched).
- [ ] Closing the tail stream (`stream-end` or disconnect) still aborts the server-side `follow` pump (`ipc.test.ts` `tail-log stream closes on client stream-end` stays green).
- [ ] Opening a tail stream for an unknown run ID is still rejected (`ipc.test.ts` `tail-log stream rejects unknown run ID` stays green).
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- No change — cross-process wake and IPC inheritance are documented in 00's `v2/docs/v2-architecture.md` update.
