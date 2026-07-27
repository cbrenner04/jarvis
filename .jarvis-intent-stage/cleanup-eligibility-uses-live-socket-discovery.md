---
name: cleanup-eligibility-uses-live-socket-discovery
---

# `jarvis cleanup` consults discovered live daemons for eligibility

## Problem

Even after cleanup stops aborting on a missing current-digest socket, eligibility still needs daemon
liveness. A live daemon on an older digest key can own a real run; a single connect to the invoking
digest misses it. `jarvis run list` already merges across discovered live sockets.

## Decisions

- Eligibility and live-run checks query every live socket from `discoverLiveDaemonSockets`, merged
  like `jarvis run list` — rules out only the current-digest IPC client.
- A live run reported by any discovered daemon makes the worktree ineligible — rules out ignoring
  older-digest daemons when the invoking key has no listener.
- Matching-key daemon behavior unchanged — rules out regressing the existing cleanup eligibility path
  when only the current digest’s daemon is live.

## Acceptance criteria

- [ ] With only a live daemon on an older digest key, `jarvis cleanup` consults it via socket
      discovery and honors a live run it reports; a regression test fails if that daemon is ignored.
- [ ] Normal cleanup with a matching-key daemon only is unchanged; existing cleanup coverage stays
      green.
- [ ] Inverting the discovery merge guard turns the older-digest regression test RED.

## Documentation updates

- `v2/docs/daemon-host.md` — cleanup eligibility uses live-socket discovery, not a single keyed
  connection.

## Prerequisites

- When no daemon listens on any key, `jarvis cleanup` still runs daemon-independent phases and marks
  worktrees ineligible instead of aborting on connect.
