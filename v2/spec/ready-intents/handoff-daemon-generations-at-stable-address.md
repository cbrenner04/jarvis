---
name: handoff-daemon-generations-at-stable-address
---

# Hand off daemon generations at one stable address

## Prerequisites

## Module-boundary surface

- Daemon lifecycle and IPC listener ownership: `v2/src/paths.ts`, `v2/src/daemon-entrypoint.ts`, `v2/src/daemon/daemon-lifecycle.ts`, `v2/src/daemon/daemon-peer-socket.ts`, and daemon startup/shutdown wiring.

## Problem

Executable digests identify the daemon's public socket, PID file, and process log. A source change therefore starts a separately addressed service, leaves the old generation discoverable only through version artifacts, and can strand unrelated projects' live work during replacement.

## Behavior

- Every generation serves through one stable public socket; an incoming generation takes that address for new work while the outgoing generation drains its admitted work and exits when idle.

## Decision ledger

- Keep the outgoing generation reachable through a private successor-only endpoint (not the public address); the incoming generation opens an internal handoff channel to that endpoint to observe drain progress and route ownership queries. Callers never see the private endpoint or channel.
- Close outgoing admission before releasing the public address, then make the incoming generation available before reporting upgrade success; rules out a socketless daemon admitting work and a changeover gap with no serving generation.
- Keep already-admitted work executing under exactly one generation; rules out duplicate execution or forced settlement during upgrade.
- Make the incoming generation the public PID owner while process logs remain readable through the stable lifecycle log contract; rules out public generation-keyed metadata.
- Treat a live pre-stable digest-keyed daemon as a legacy outgoing generation: the incoming generation uses that daemon's existing digest-keyed socket as its private successor-only endpoint and drains it over the same handoff channel, using the run/pipeline RPCs that socket already answers today — no legacy-side code change required. Rules out the first stable-address rollout orphaning work already admitted by the old layout.

## Acceptance criteria

- [ ] A daemon lifecycle test proves an incoming generation admits new work at the stable address while the outgoing generation continues its existing run, and the outgoing generation exits after that run settles; it fails against the pre-fix keyed-socket coexistence model.
- [ ] A changeover-race test proves the outgoing generation refuses new admission before it releases the public address and the incoming generation is reachable when handoff completes.
- [ ] A multi-project test proves upgrading for one project does not interrupt an in-flight run from a second registered project; it fails against #3595's pre-fix shape.
- [ ] A migration test proves a live compatible daemon on a legacy digest-keyed socket is drained without losing its admitted work when the first stable-address generation starts.
- [ ] A lifecycle test proves idle outgoing generations exit and leave no public socket or PID ownership behind.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — stable public address, selected internal handoff mechanism, admission cutoff, overlap, drain, and exit ownership.
- `v2/docs/v2-architecture.md` — daemon generation handoff boundary and stable public endpoint.
- `v2/docs/v1-behaviors.md` — replace public digest-keyed daemon identity with the stable-address handoff behavior.
- `v2/docs/operator-runbook.md` — state that an upgrade preserves unrelated live work and needs no manual daemon stop.
