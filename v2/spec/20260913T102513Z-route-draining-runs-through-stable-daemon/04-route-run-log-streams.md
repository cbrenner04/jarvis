# Route run log streams

## Problem

The stable daemon opens every run-log stream against its own tail handler. A draining run's authoritative replay and follow lifecycle remain attached to the outgoing generation.

## Behavior

A stable-address stream resolves route authority, opens the owner's private stream, and relays replay, follow records, completion, failure, and cancellation without exposing the intermediate generation.

## Decisions

- Route an owner-routable draining run's stream to its owner instead of reading the successor's shared log view; rules out storage visibility being mistaken for execution ownership.
- Preserve the caller's `afterSeq` and `follow` payload unchanged on the owner stream; rules out duplicate replay or altered follow semantics at the proxy.
- Relay owner data in order and emit one public stream end carrying an owner or route error; rules out converting route failure into a successful end-of-log.
- Closing either public side or owner side tears down the other's stream resources; rules out a disconnected tail keeping a draining daemon alive.
- Use the local tail handler when no route owns the run; rules out routing terminal history or incoming-owned work unnecessarily.

## Tasks

- Compose a route-aware tail handler over the local handler and an internal owner-stream client.
- Wire the composed handler to both daemon endpoints for hop-by-hop drain chains.
- Cover replay, follow, sequence forwarding, completion, failure, and cancellation.

## Acceptance criteria

- [ ] `v2/src/daemon/daemon-run-log-routing.test.ts` proves stable-address replay and follow frames come from the draining owner's stream in sequence and fails against the pre-fix local tail handler.
- [ ] `v2/src/daemon/daemon-run-log-routing.test.ts` proves `afterSeq`, `follow`, normal end, owner error, and public `run_routing_unavailable` retain their public stream semantics across the proxy.
- [ ] `v2/src/daemon/daemon-run-log-routing.test.ts` proves public cancellation closes the owner stream and owner disconnect closes the public stream exactly once.
- [ ] `v2/src/daemon/daemon-run-routing.sandbox-unrunnable.test.ts` proves a real `stream-open` on the stable public socket replays and follows an outgoing generation's live log.
- [ ] `v2/src/daemon/daemon-tail-stream.test.ts` stays green (single-generation replay and follow behavior unchanged).
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/daemon-host.md` — document routed run-log streams, payload preservation, terminal/error relay, and cancellation.
- `v2/docs/v1-behaviors.md` — record stable-address log replay and follow for draining runs.
