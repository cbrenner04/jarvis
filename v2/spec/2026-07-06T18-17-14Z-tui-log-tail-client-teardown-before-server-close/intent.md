---
name: tui-log-tail-client-teardown-before-server-close
---

# tui-log-tail-client.test.ts afterEach destroys client connection before calling server.close()

## Prerequisites

## Problem

`v2/src/tui/tui-log-tail-client.test.ts`'s `afterEach` calls `server.close()` without first
destroying the client socket / aborting the tail iterator. A thrown assertion mid-test can leave
a connection open, leaking it into teardown where `server.close()` may stall.

## Decisions

- `afterEach` destroys the client socket / aborts the tail iterator before calling `server.close()`.
- Defense-in-depth: the server-side concurrent-drain fix is what makes teardown safe regardless,
  but this test's own hygiene should not depend on it.

## Tests

- Existing `tui-log-tail-client.test.ts` stays green with the reordered teardown.

## Out of scope

- Any change to `IpcServer.close()` itself.

## Documentation updates

- None expected; test-only hygiene change.
