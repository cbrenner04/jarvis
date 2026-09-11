# Handoff changeover protocol

## Problem

With one public address ([00](./00-stable-public-daemon-address.md)), a second generation starting while a first is serving hits the occupancy refusal and cannot start. Replacement must instead be a handoff: the outgoing generation stops admitting, releases the address, and the incoming generation takes it — with no window in which an unreachable or non-admitting daemon owns the public address.

## Behavior

An incoming generation that finds a live peer on the public address opens an internal handoff channel to it and requests changeover. The outgoing generation, in this order: closes admission (the existing retiring state, so `start`/`resume`/pipeline admission answer `daemon_superseded`), reports its private successor-only endpoint path to the successor, then releases the public address. The incoming generation binds the public address and reports startup success only after it answers on it. Callers never address the private endpoint; it is an internal handoff detail.

## Decisions

- Reuse the existing retiring state (`setRetiring` / `daemon_superseded`) as the admission cutoff; rules out a second, separately-tested cutoff concept alongside supersession.
- The handoff request is a single RPC on the public address that returns the outgoing generation's private endpoint path and only then releases the public listener; rules out a two-call sequence whose interleaving could release the address before the successor knows where to observe drain.
- Admission cutoff takes effect before the reply is sent, so no work can be admitted by the outgoing generation after the successor has been told to take the address; rules out a last-moment admission the successor never learns about.
- If the outgoing generation fails to release the address or never replies, the incoming generation fails startup rather than unlinking a live peer's socket; rules out the bound-but-unlinked-inode failure `v2/docs/daemon-host.md` § Socket path already documents.
- Work already admitted by the outgoing generation keeps executing there and is neither re-dispatched nor force-settled by the successor; rules out duplicate execution or forced settlement during upgrade.

## Acceptance criteria

- [ ] A changeover-race test proves the outgoing generation refuses new admission with `daemon_superseded` at a point strictly before it releases the public address, and that the public address answers `health` from the incoming generation once handoff reports success; it fails against the pre-fix refusal-on-occupied-address behavior.
- [ ] A lifecycle test proves an incoming generation admits a new run at the stable address while the outgoing generation's already-admitted run keeps running under the outgoing generation; it fails against the pre-fix keyed-socket coexistence model pinned by `keyed-daemon-coexistence.sandbox-unrunnable.test.ts`.
- [ ] A test proves an incoming generation whose handoff request goes unanswered fails startup and leaves the incumbent's public socket serving.
- [ ] A test proves the handoff RPC reply names the outgoing generation's private endpoint and that the endpoint answers after the public address is released.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/daemon-host.md` — the handoff RPC, ordering (admission cutoff → private endpoint disclosure → public release → incoming bind → ready), and the failure mode when the incumbent does not release.
- `v2/docs/v1-behaviors.md` — record that generation replacement is a handoff at the stable address rather than keyed-socket coexistence.
