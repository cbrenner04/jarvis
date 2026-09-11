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

- Pin the internal handoff mechanism in the first implementing subspec: either keep the outgoing generation on a private successor-only endpoint or transfer its live ownership state; callers never see that mechanism.
- Close outgoing admission before releasing the public address, then make the incoming generation available before reporting upgrade success; rules out a socketless daemon admitting work and a changeover gap with no serving generation.
- Keep already-admitted work executing under exactly one generation; rules out duplicate execution or forced settlement during upgrade.
- Make the incoming generation the public PID owner while process logs remain readable through the stable lifecycle log contract; rules out public generation-keyed metadata.
- Bring a compatible pre-stable keyed daemon into the same drain contract during migration; rules out the first stable-address rollout orphaning work already admitted by the old layout.

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
