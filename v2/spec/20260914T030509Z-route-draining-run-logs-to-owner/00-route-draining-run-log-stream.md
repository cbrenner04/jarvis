# Route draining run log stream to the direct owner

## Problem

The stable daemon's `tail` stream handler (`v2/src/daemon/daemon-tail-stream.ts`) reads its own log reader, so `run log` / `run log --follow` for a run still owned by the draining direct predecessor returns incomplete history or never follows live output.

## Decisions

- Route the stable-address stream handler through the same ownership check as `createStableRunHandlers` (`ownsRunLocally` → `resolvePredecessorOwner` → recheck local); rules out a separate ownership RPC or CLI-side socket selection.
- Private endpoints keep the local stream handler; rules out owner-side re-forwarding that could chain through older generations.
- With no `predecessorSocketPath`, wire the plain local handler (no wrapper); rules out a per-stream ownership lookup on single-daemon hosts.
- Forward the original `tail` params unchanged over one owner stream and relay each owner `stream-data` payload to the caller in arrival order; rules out buffering replay or re-reading locally.
- Owner normal `stream-end` → caller normal end; owner error `stream-end` → caller error end with the owner's code/message; owner connection loss before end → caller error end, never a successful end.
- Caller abort closes the owner connection; rules out leaving an owner follow stream open after the caller leaves.
- Terminal or not-predecessor-owned runs use the existing local handler; rules out routing historical lookups to the predecessor.

## Task checklist

- [ ] Add a stable stream wrapper beside the unary routing and wire it for the public endpoint only.
- [ ] Add unit and transport tests.
- [ ] Update docs.

## Acceptance criteria

- [ ] A transport regression proves `run log` replay through the stable address returns the direct predecessor owner's records in order; it fails against the pre-fix successor-local reader.
- [ ] A transport regression proves `tail` follow through the stable address forwards records the owner emits after open and ends normally when the owner stream ends.
- [ ] A test proves caller cancellation aborts the owner-side stream handler's signal, leaving no open follow.
- [ ] A test proves owner disconnect mid-follow ends the caller stream with an error, not a successful end.
- [ ] `v2/src/daemon/daemon-tail-stream.test.ts` stays green.
- [ ] A single-daemon test proves the stream path performs no ownership lookup when no predecessor is configured.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/daemon-host.md` — stable routing: `tail` stream bridges to the direct owner; cancel and owner-loss semantics.
- `v2/docs/v2-architecture.md` — stable-front-door run-stream routing boundary.
- `v2/docs/v1-behaviors.md` — draining-run logs stay replayable and followable through the stable daemon.
