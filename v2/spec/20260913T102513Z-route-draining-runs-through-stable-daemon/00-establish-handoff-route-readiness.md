# Establish handoff route readiness

## Problem

A successor serves its public address before it knows whether its predecessor owns live work. A second handoff can also strand an earlier generation when an intermediate exits after its own work drains.

## Behavior

Before the successor serves public run admission or owner-sensitive requests, it obtains a usable handoff route snapshot or fails those requests closed. A three-generation chain remains hop-by-hop routable, and an intermediate remains alive while it owns downstream routes or forwarded requests.

## Decisions

- Define the supported topology as stable C → private B → private A, with every hop routing through its direct predecessor; rules out C enumerating or addressing A directly.
- Treat a predecessor `list { includeDismissed: true }` reply as sufficient first-rollout route discovery; rules out requiring a new outgoing-daemon wire field or handoff RPC.
- Gate public `start`, `resume`, `wait`, `pause`, `kill`, and `stream-open` until the first route snapshot succeeds or route setup conclusively fails; rules out serving the post-changeover race with an empty directory.
- Return public `run_routing_unavailable` for an unready or timed-out route setup; rules out exposing a private socket path, generation identity, or a successor-local ownership verdict.
- Choose local ownership before direct-predecessor ownership, then nearest handoff hop before an older duplicate; rules out nondeterministic duplicate selection from socket order.
- Retire an intermediate only after local work, routed ownership, and forwarded requests are all empty; rules out B exiting while C still reaches A through B.

## Tasks

- Replace live-ID-only handoff setup with an initial route snapshot and a readiness gate.
- Preserve one private-hop client per predecessor and route a three-generation chain hop by hop.
- Keep the directory client compatible with an outgoing daemon that implements only current `list`, RPC, and `stream-open` contracts.

## Acceptance criteria

- [x] `v2/src/daemon/daemon-handoff-route-readiness.test.ts` proves immediate post-changeover `start`, `resume`, owner-sensitive `wait`, and `kill --force` fail closed until route readiness settles; it fails against the pre-fix empty `externalLiveRunIds` window.
- [x] `v2/src/daemon/daemon-handoff-route-readiness.test.ts` proves a C → B → A chain routes A-owned work through B, applies deterministic nearest-hop duplicate precedence, and keeps B alive while it owns A's route or a forwarded request; it fails against the pre-fix one-hop observer and local-active-only retirement guard.
- [x] `v2/src/daemon/daemon-handoff-route-readiness.test.ts` proves a successor interoperates with an outgoing daemon exposing only current `list`, RPC, and `stream-open` forms; it fails against a protocol extension required at handoff.

## Documentation updates

- `v2/docs/daemon-host.md` — document handoff readiness, public `run_routing_unavailable`, three-generation relay topology, retirement, and first-rollout compatibility.
- `v2/docs/v1-behaviors.md` — record fail-closed handoff routing and chain-safe draining generations.
