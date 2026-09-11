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

## Review findings (2026-09-11, independent diff review)

**The handoff protocol is unreachable from production.** `startDaemon` still probes the target socket and throws `DaemonAlreadyRunningError` before spawning when anything answers (`v2/src/daemon/daemon-lifecycle.ts`). A daemon process only ever starts through `startDaemon`, so a live incumbent at the public address means the successor is never spawned and `changeover` is never requested. Both real-socket handoff tests reach `startDaemonRuntime` directly and bypass this. The rebuild-to-replacement path this subspec exists for still fails with the old occupancy refusal.

**Release and bind are unsynchronized, in both directions.** `changeoverHandler` fires `void server.close()` without awaiting, then replies. `createIpcServerClose` stops listening, drains active client sockets up to `DEFAULT_DRAIN_TIMEOUT_MS`, and only then `rmSync`s the socket path. So (a) any lingering connection on the outgoing generation — a log tail, a `wait` long-poll, the TUI — holds the drain open long enough for the successor to bind the same path, and the outgoing generation then unlinks the *successor's* live socket, reproducing the bound-then-unlinked outage; and (b) if the incumbent is still listening when the successor probes, the successor exits 1 while the incumbent has already retired, leaving no admitting daemon. The handoff must acknowledge that the address was actually released. The `@mutate-equivalent` directive on that `rmSync` claiming no observable effect was true before this change and is now false.

**`requestChangeoverFromPublicPeer` fails open on connect errors.** Any `connectIpcClient` rejection maps to `{kind: "no-peer"}`, so a live daemon with a full accept backlog (`ECONNREFUSED` on a Unix socket) or a permission error lets the successor proceed to bind, where the same busy socket can be classified stale and unlinked. Only timeout and RPC failures fail closed; connect failure must too.

**Aborted startup leaks the bound private endpoint.** On `handoff-failed` the throw reaches the catch, which calls `processExit(1)` without closing `privateServer`, and the catch has no `return` between its two exit paths — with an injected non-throwing `processExit` it falls through and uses the unassigned `server`.

**Criteria that were ticked but not proven.** AC 1 does not pin the *ordering* it claims: the test checks the close happened, then that a later `start` is refused, and would pass identically if `setRetiring()` ran after `server.close()` — assert the order. AC 3 injects a canned `handoff-failed` with no incumbent present and asserts only which paths were bound; nothing proves an incumbent survives, and the real unanswered-request path is never exercised. AC 2's pin was removed rather than converted: `keyed-daemon-coexistence.sandbox-unrunnable.test.ts` lost its two-daemon coexistence case entirely (2 tests to 1) — restore an equivalent real-socket assertion.
