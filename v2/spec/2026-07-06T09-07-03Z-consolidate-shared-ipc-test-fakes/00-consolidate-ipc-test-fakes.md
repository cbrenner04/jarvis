# Consolidate fake IpcClient and fixed-uuid helpers

`v2/src/cli.test.ts` and `v2/src/tui/tui-daemon-client.test.ts` each hand-roll a fake
`IpcClient` and a fixed-uuid helper. Move both into `v2/src/testing/` so there is one
implementation.

## Decisions

- New `v2/src/testing/ipc-client-fake.ts` exports `makeIpcClient(frames, sent?)` and
  `createDeferredIpcClient(sent?)` — replaces both files' local `makeClient` plus cli's
  `makeBlockingClient` and tui's `createDeferredClient`.
- `makeIpcClient` uses cli's ungated semantics: `nextFrame()` returns the next queued
  frame immediately regardless of how many `send()` calls have occurred, throwing once
  the queue is empty. Tui's send-gated variant (a frame only delivers once
  `deliveredCount < sentCount`) is dropped — cli's streaming test sends one
  `stream-open` frame then calls `nextFrame()` four times to drain four queued response
  frames, which hangs forever under send-gating. No tui fake-client call site depends on
  gating: every tui use of `makeClient` pairs one `send()` with one `nextFrame()`, so
  cli's ungated queue covers it unmodified. (Tui's socket round-trip tests exercise the
  real `connectIpcClient`, not this fake, and are unaffected — out of scope.)
- `createDeferredIpcClient` uses the tui implementation's queuing `push` (accepts frames
  pushed before `nextFrame` is awaited) rather than cli's single-shot `resolve` — the
  queuing version covers cli's single-push use unmodified, the reverse is not true.
- cli.test.ts call sites that used `.resolve(frame)` switch to `.push(frame)`; behavior
  is identical for a single push.
- New `v2/src/testing/fixed-uuid.ts` exports `withFixedUuid(idOrIds, fn)` accepting a
  single id (cli's usage) or an array consumed in order (tui's usage) — one name, one
  call site per test file, decided by the argument shape.
- `IpcClient`/`IpcFrame` types are imported into the new testing module from
  `../ipc/client.ts` / `../ipc/types.ts`; no changes to production `ipc/` code.

## Out of scope

- Any change to `tui-daemon-client.test.ts`'s socket round-trip test coverage.
- Any change to daemon handler test files.

## Acceptance criteria

- [ ] `bun test v2/src/cli.test.ts` passes with no local `makeClient`, `makeBlockingClient`,
      or `withFixedUuid` definitions remaining in `v2/src/cli.test.ts`.
- [ ] `bun test v2/src/tui/tui-daemon-client.test.ts` passes with no local `makeClient`,
      `createDeferredClient`, or `withFixedUuids` definitions remaining in
      `v2/src/tui/tui-daemon-client.test.ts`.
- [ ] Both test files import `makeIpcClient`/`createDeferredIpcClient`/`withFixedUuid`
      from `v2/src/testing/`.
- [ ] Every existing `makeClient`/`createDeferredClient` call site in
      `tui-daemon-client.test.ts` still passes against the shared, ungated
      `makeIpcClient` (no call site relies on send-gated delivery).

## Documentation updates

None — internal test-helper refactor, no operator-facing or v1-parity behavior change.
