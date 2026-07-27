---
name: cleanup-eligibility-uses-live-socket-discovery
---

# `jarvis cleanup` consults discovered live daemons for eligibility

## Problem

After cleanup stops aborting on a missing current-digest socket, eligibility still needs daemon liveness. A live daemon on an older digest key can own a real run; a single connect to the invoking digest misses it. `jarvis run list` already merges across discovered live sockets.

## Decisions

- Eligibility and live-run checks query every live socket from `discoverLiveDaemonSockets` ∪ invoking digest socket (same query set as `jarvis run list`); empty discovery still probes only the invoking socket — rules out discovery-only behavior that skips the invoking socket.
- Reuse `discoverLiveDaemonSockets`; rules out a second discovery implementation.
- Skip a socket that fails to answer without failing the whole command — rules out one dead socket blanking eligibility for all worktrees.
- A live run reported by any queried daemon makes the worktree ineligible — rules out ignoring older-digest daemons when the invoking key has no listener.
- When only the invoking digest's daemon is live, eligibility matches today — rules out regressing the existing matching-key cleanup path.

## Acceptance criteria

- [ ] With only a live daemon on an older digest key, `jarvis cleanup` consults it via socket discovery and honors a live run it reports; a regression test in `v2/src/commands/cleanup.test.ts` or `cleanup-cli.test.ts` fails if that daemon is ignored.
- [ ] Matching-key-only daemon: existing cleanup eligibility tests in `cleanup.test.ts` and `cleanup-cli.test.ts` stay green without behavior change.
- [ ] Inverting the discovery merge guard turns the older-digest regression test RED.

## Documentation updates

- `v2/docs/daemon-host.md` — cleanup eligibility uses live-socket discovery, not a single keyed connection.
- `v2/docs/v1-behaviors.md` — record cleanup multi-socket eligibility discovery.

## Prerequisites

- When no daemon listens on any key, `jarvis cleanup` still runs daemon-independent phases and marks worktrees ineligible instead of aborting on connect.
