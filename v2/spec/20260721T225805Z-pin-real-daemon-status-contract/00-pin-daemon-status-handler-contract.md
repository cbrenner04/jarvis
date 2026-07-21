# Pin the daemon status handler contract

## Problem

The real daemon status handler has no regression test proving that matching executable digests advance its recorded revision and that its reply includes the loaded executable digest.

## Decisions

- Invoke the status handler constructed by `startDaemonRuntime` in-process; rules out fake-handler coverage or a detached daemon process.
- Send HEAD drift with the handler's loaded digest and assert the exact advanced revision and digest reply; rules out type-only or partial status assertions.

## Work

- Add a focused `daemon status contract` regression test that captures and invokes the production handler through the daemon startup seam.
- Assert matching-digest HEAD drift advances `loadedRevision` and preserves `loadedExecutableDigest` in the response.

## Acceptance criteria

- [x] The `daemon status contract` regression test invokes the production status handler with matching digest and HEAD drift.
- [x] The test fails if the production handler does not advance `loadedRevision` to the invoking HEAD.
- [x] The test fails if the production reply omits or changes `loadedExecutableDigest`.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

None — `v2/docs/daemon-host.md` and `v2/docs/write-behavior.md` already define this contract.
