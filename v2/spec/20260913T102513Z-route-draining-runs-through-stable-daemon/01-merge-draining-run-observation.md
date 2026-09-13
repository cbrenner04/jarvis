# Merge draining run observation

## Problem

The incoming daemon reduces a predecessor to `isLive` IDs and rebuilds rows from durable state. That loses owner-only fields and treats public liveness as the ownership witness, although controllable paused rows and completed workflow siblings need routing without being `isLive`.

## Behavior

The stable daemon keeps route authority from a reachable owner's returned row independently of its public `isLive` projection, and composes one owner-winning row per run for its draining chain. Clients continue their existing discovered-socket merge during this interim boundary.

## Decisions

- Record owner authority from every returned owner row in a confirmed route snapshot, while deriving public `isLive` only from the owner's `isLive` field; rules out making `isLive` the authority marker.
- Keep a reachable owner's paused row and a completed workflow sibling routable even when their public row is not live; rules out successor-local `run_not_active` for controls the owner still accepts.
- Merge local and routed rows with the local live owner first, then the deterministic route precedence; rules out client-side generation aggregation and successor-derived owner fields.
- Retain the last confirmed route snapshot across a list failure only while its liveness probe remains live; rules out timeout-induced false death and indefinite ownership after endpoint loss.
- Include dismissed rows in route discovery but apply each caller's dismissal, filters, retention, and limit after composition; rules out dismissal making executing work uncontrollable or draining rows using different list semantics.
- Keep client discovery and its cross-socket dedupe unchanged in this slice; rules out documenting the stable daemon as the sole client aggregation boundary.

## Tasks

- Replace the predecessor live-ID projection with route-aware owner rows and authority metadata.
- Merge local and draining snapshots in the stable `list` handler before applying the caller-selected view.
- Preserve direct handler composition and a real two-generation stable-address request.

## Acceptance criteria

- [x] `v2/src/daemon/daemon-run-routing.test.ts` proves the stable list returns one draining-owned row, preserves differing owner fields, and reports `isLive: true` only when the owner reports it; it fails against the pre-fix successor-local projection.
- [x] `v2/src/daemon/daemon-run-routing.test.ts` proves a paused active row and a completed workflow sibling remain owner-routable without being promoted to public `isLive`; it fails against the pre-fix `isLive`-only owner witness.
- [x] `v2/src/daemon/generation-drain-and-exit.sandbox-unrunnable.test.ts` proves a real stable public address returns the outgoing generation's live run exactly once while the incoming generation serves.
- [x] `v2/src/daemon/daemon-run-routing.test.ts` proves filtered, dismissed, and retention-sensitive list requests apply to the merged view rather than omitting or duplicating draining rows.
- [x] `v2/src/daemon/daemon-drain-observer.test.ts` stays green (transient-failure and endpoint-loss observation behavior preserved).
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/daemon-host.md` — replace live-ID drain observation with route authority, owner-winning stable-chain list semantics, and unchanged client discovery/deduplication.
- `v2/docs/v2-architecture.md` — distinguish stable-chain composition from the still-client-owned cross-socket aggregation boundary.
- `v2/docs/v1-behaviors.md` — record generation-transparent stable-chain liveness and owner-row merging without claiming client migration.
