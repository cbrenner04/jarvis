---
name: consolidate-shared-ipc-test-fakes
---
# Consolidate Shared Ipc Test Fakes

# Consolidate the fake IpcClient and fixed-uuid helpers used by cli and tui tests

`v2/src/cli.test.ts` and `v2/src/tui/tui-daemon-client.test.ts` each separately implement
a fake `IpcClient` (`makeClient`/`makeBlockingClient` vs `makeClient`/
`createDeferredClient`) and a fixed-uuid test helper (`withFixedUuid` vs
`withFixedUuids`). Consolidate each into one shared implementation in `v2/src/testing/`.

## Decisions

- One fake `IpcClient` factory in `v2/src/testing/` covers both files' needs, including
  the blocking/deferred-response variants.
- One `withFixedUuid` helper in `v2/src/testing/` merges the cli and tui variants
  (single-id and multi-id fixed-uuid sequencing).
- Both test files import the shared helpers and drop their local copies.

## Out of scope

- Any change to `tui-daemon-client.test.ts`'s socket round-trip test coverage (separate
  intent).
- Any change to daemon handler test files.

## Verification

`cli.test.ts` and `tui-daemon-client.test.ts` pass unchanged; no local `makeClient`,
`makeBlockingClient`, `createDeferredClient`, `withFixedUuid`, or `withFixedUuids`
definitions remain in either file.

## Prerequisites
