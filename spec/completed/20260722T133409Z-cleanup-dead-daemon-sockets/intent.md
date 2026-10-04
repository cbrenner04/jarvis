---
name: cleanup-dead-daemon-sockets
---

# Clean up dead daemon sockets

## Problem

- Digest-keyed daemon turnover leaves socket paths that may no longer have a live owner.

## Outcome

- Cleanup removes dead daemon sockets and preserves every socket owned by a live daemon.

## Decisions

- Prove a keyed socket dead before removing it; rules out age-, digest-, or current-version-based deletion.
- Treat each socket independently; rules out assuming only the invoking digest can be live.
- Preserve an unprobeable socket; rules out deleting on probe errors or incomplete results.
- Keep daemon-socket cleanup automatic within the existing cleanup workflow; rules out a separate operator command.

## Acceptance criteria

- [ ] Cleanup discovers executable-digest-keyed daemon sockets.
- [ ] Cleanup removes a socket only when no daemon is serving it.
- [ ] Cleanup preserves current, superseded, and otherwise live daemon sockets.
- [ ] A partial probe failure cannot cause a live socket to be removed.
- [ ] A regression test in `v2/src/commands/daemon.test.ts` proves cleanup preserves an unprobeable socket; it fails on baseline.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — dead-socket ownership and reaping rule.
- `v2/docs/write-behavior.md` — cleanup-visible daemon artifact behavior.
- `v2/docs/operator-runbook.md` — cleanup behavior with overlapping daemons.
- `v2/docs/v1-behaviors.md` — record daemon-socket cleanup.

## Prerequisites

- Daemon sockets use the executable-digest-keyed naming scheme.
