# Routing fallback and drain-exit independence

## Problem

Ownership-directory setup ([01](./01-direct-predecessor-ownership-directory.md)) must never make the stable daemon refuse otherwise-normal work, and a retiring generation's exit — and its successor's own serving — must not depend on that directory staying populated.

## Behavior

If constructing or polling the ownership directory fails at daemon startup, `list` and every other handler still start and serve local behavior; no verb is refused because of routing setup. An idle retiring generation exits under its existing drain-exit rule (no active runs) independent of whatever ownership directory it happens to be polling, and a successor's own `list` serving does not depend on a drained predecessor remaining reachable.

## Decisions

- Ownership-directory construction follows the existing drain observer's non-throwing tick pattern (`daemon-drain-observer.ts`: every RPC/connect failure is caught inside the poll, never thrown to the caller); directory setup failure therefore degrades to an empty directory rather than propagating; rules out a synchronous-connect implementation that could reject `startDaemonRuntime`.
- The outgoing generation's exit trigger (`shouldShutdownNow`: retiring ∧ no active runs) reads only its own active-run set, never its own predecessor's ownership directory; rules out an idle retiring generation staying alive to keep forwarding an older generation's rows.
- The successor's `list` handler keeps serving local candidates normally once its predecessor's directory goes empty (drained or unreachable); rules out the successor's own serving depending on a drained predecessor staying reachable.

## Tasks

- Ensure ownership-directory construction/polling cannot prevent daemon startup or make `list`/other handlers refuse.
- Confirm the retiring generation's exit condition and the successor's own serving path never read a predecessor's ownership directory as a liveness gate.

## Acceptance criteria

- [ ] `daemon-stable-run-list.test.ts` proves that when the ownership directory's poll to `predecessorSocketPath` fails at startup (unreachable socket), `list` and an unrelated handler still start and resolve using local behavior, with no routing-wide refusal; it fails against a naive implementation where directory setup is awaited synchronously during `startDaemonRuntime` and its rejection propagates.
- [ ] `generation-drain-and-exit.sandbox-unrunnable.test.ts` proves an idle retiring generation exits without waiting on its own predecessor's ownership directory, and separately proves the successor's `list` keeps resolving normally after its predecessor exits and its ownership directory goes empty.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/daemon-host.md` — routing setup-failure fallback and drain-exit independence from a predecessor's own directory.
