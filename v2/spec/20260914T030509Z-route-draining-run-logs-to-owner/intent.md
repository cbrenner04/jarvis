---
name: route-draining-run-logs-to-owner
---

# Route draining run logs to the owner

## Prerequisites

- Daemon upgrades hand off one stable public address: the incoming generation admits new work, the outgoing generation admits nothing new, finishes its owned work, and exits when idle.
- The stable daemon merges its direct predecessor's authoritative live run rows into `run list`, with one row per run and the live owner's row winning.
- The stable daemon routes waits and owner-sensitive live controls for a draining run to its direct owner over the internal handoff channel.

## Module-boundary surface

- Run-log replay/follow stream bridging over the internal handoff channel.

## Problem

The stable daemon opens `run log` against its own log reader. A draining run's authoritative replay and follow stream remains on the predecessor, so the stable address can return incomplete history or fail to follow live output.

## Behavior

- The stable daemon replays and follows a draining run's log from its direct owner, preserving one caller-visible stream across the internal owner route.

## Decisions

- Select the stream source from the authoritative live-run directory and keep current-generation streams local.
- Proxy replay and follow frames in order, including normal end, caller cancellation, and owner disconnect, without exposing the private endpoint.
- Route only live predecessor-owned runs; terminal and historical log lookup keeps existing stable-daemon behavior.
- Preserve the single-daemon stream path without an ownership RPC.

## Acceptance criteria

- [ ] A transport regression proves `run log` replays a direct predecessor owner's records in order through the stable address; it fails against the pre-fix successor-local reader.
- [ ] A transport regression proves `run log --follow` forwards new owner records and closes when the owner stream ends.
- [ ] Tests prove caller cancellation and owner disconnect close both sides without a leaked follow stream or a false successful end.
- [ ] Single-daemon replay/follow regressions stay green without an internal routing RPC.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — direct-owner log replay/follow bridging and stream loss behavior.
- `v2/docs/v2-architecture.md` — stable-front-door run-stream routing boundary.
- `v2/docs/v1-behaviors.md` — draining-run logs remain replayable and followable through the stable daemon.

## Blocker

Code investigation contradicts the Problem statement: the stable daemon's local reader already correctly replays and follows a predecessor-owned run's log, and the real callers never even reach that unrouted path.

- `logsPath` (`v2/src/daemon/daemon.ts:1172`) and the orchestration state store (`v2/src/persistence/state-store.ts:3063-3067`, WAL-mode SQLite, `loadRun` is a plain query with no cache, `:1956-1967`) are the same file across daemon generations — no per-generation or per-socket scoping exists (`v2/src/paths.ts:5-36`).
- `FileLogStream.append` (`v2/src/persistence/log-stream.ts:390-401`) is synchronous (`appendFileSync`); `tail`/`follow` (`log-stream.ts:403-430`) do fresh polling reads with no in-memory-only delivery path, so a successor's local reader sees the predecessor's writes with no gap, and `streamRunLogRecords` (`v2/src/daemon/daemon-tail-stream.ts`) detects predecessor-run termination on its own via the same shared `loadRun`.
- Separately, `run log` / `tui log` never reach a stable-daemon local handler for a draining run today: they resolve the true owner socket client-side first (`resolveRunOwnerSocket` in `v2/src/commands/run.ts`, `resolveOwningSocket` in `v2/src/tui/tui-log-follow-entry.tsx`) and connect directly to the predecessor's private socket. `v2/docs/daemon-host.md` documents this as existing, intentional design: "`resume`, dismissal, log-tail streaming, and admission RPCs retain their existing paths" (Direct-owner run unary routing) and "log uses the owning socket" (Socket discovery).

Verdict item 1 anticipated the replay AC might not be falsifiable and offered a fallback ("put the required failing test on follow"), but the settled answer is that both replay and follow already work locally, and no caller exercises the unrouted path — there is no failing-test surface for either, and no data-completeness or liveness bug to fix by adding stream routing.

Needs an operator decision before this can be replanned: is the real goal (a) architectural symmetry — replace client-side owner-socket discovery for log-tail with stable-daemon server-side routing like `wait`/`pause`/`kill`, purely for consistency, with the Problem/Behavior/AC rewritten to say so instead of asserting a bug; or (b) something the investigation missed? The intent needs that answer before its Problem/Behavior/Acceptance criteria can be corrected.
