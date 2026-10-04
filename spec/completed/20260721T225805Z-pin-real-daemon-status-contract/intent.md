---
name: pin-real-daemon-status-contract
---

# Pin the real daemon status contract

## Problem

- No test drives the real daemon status handler's revision advance and executable-digest reply, so either behavior can disappear without a failure.

## Outcome

- An agent-runnable test invokes the production status handler and observes revision advancement plus the loaded executable digest in its reply.

## Decisions

- Exercise the production handler in-process; rules out accepting fake-handler coverage or requiring a daemon process for this contract.
- Assert both revision advancement and digest propagation; rules out a type-only assertion on `loadedRevision` or partial status coverage.

## Acceptance criteria

- [ ] The `daemon status contract` regression test drives the production handler with matching digest and HEAD drift.
- [ ] The `daemon status contract` regression test fails if the handler does not advance the revision.
- [ ] The `daemon status contract` regression test fails if the reply omits `loadedExecutableDigest`.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- None — this slice adds coverage for the existing documented daemon status contract.

## Prerequisites
