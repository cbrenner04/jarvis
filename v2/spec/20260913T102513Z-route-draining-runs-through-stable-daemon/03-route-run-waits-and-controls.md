# Route run waits and controls

## Problem

The stable daemon handles `wait`, `pause`, and `kill` against its own registry. A draining owner's live or owner-routable run therefore waits on the wrong log reader or rejects controls as inactive.

## Behavior

After route readiness, the stable daemon relays owner-sensitive request/response run verbs to the owning route and returns the owner's result. A reachable route timeout is public `run_routing_unavailable`; confirmed route loss is public `run_owner_lost`.

## Decisions

- Forward `wait`, `pause`, and `kill` when route authority names a draining owner; rules out successor-local `run_not_active` handling for owner-routable work.
- Relay owner success and RPC errors unchanged except route timeout or confirmed loss; rules out successor-specific refusal codes masking the owner's result.
- Return `run_routing_unavailable` while the owner endpoint remains live but the route request times out, and `run_owner_lost` after confirmed loss; rules out leaking private endpoints or generation identities.
- Abort a forwarded wait when its public caller disconnects; rules out orphaned long-polls keeping a draining endpoint busy.
- Wire relay handlers on public and private endpoints; rules out a three-generation chain terminating at an intermediate daemon.

## Tasks

- Add a route-aware wrapper around local owner-sensitive run handlers.
- Relay owner requests and cancellation identically on public and private daemon endpoints.
- Prove routed waits, live controls, owner errors, and cancellation.

## Acceptance criteria

- [ ] `v2/src/daemon/daemon-run-routing.test.ts` proves `wait` reaches a draining owner and returns its eventual settlement through the stable handler; it fails against the pre-fix successor-local wait.
- [ ] `v2/src/daemon/daemon-run-routing.test.ts` proves `pause`, `kill`, and `kill --force` reach the draining owner's live invocation while the incoming executor and force-settlement path remain untouched; it fails against the pre-fix `run_not_active` path.
- [ ] `v2/src/daemon/daemon-run-routing.test.ts` proves disconnecting a stable-address waiter aborts its forwarded owner request without affecting the run or another waiter.
- [ ] `v2/src/daemon/daemon-run-routing.test.ts` proves a reachable timeout reports `run_routing_unavailable` and confirmed loss reports `run_owner_lost` without private route details; it fails against the pre-fix local refusal or leaked transport error.
- [ ] `v2/src/daemon/daemon-run-routing.sandbox-unrunnable.test.ts` proves real stable-address `wait` and `kill` reach an outgoing generation and settle its run.
- [ ] `v2/src/daemon/daemon-start-list.test.ts` stays green (single-generation kill behavior unchanged).
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/daemon-host.md` — document stable-address waits and controls, timeout/loss errors, forwarded cancellation, and private-hop relay.
- `v2/docs/v1-behaviors.md` — record that draining runs remain waitable, pausable, and killable without transferring live execution.
