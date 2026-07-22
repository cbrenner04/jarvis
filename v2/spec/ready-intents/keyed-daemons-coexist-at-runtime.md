---
name: keyed-daemons-coexist-at-runtime
---

# Keyed daemons coexist at runtime

## Problem

- Digest-keyed paths are resolved, but nothing proves two daemons with different digests actually run at once over real sockets without observing each other's runs.

## Outcome

- Two daemons started under different executable digests are simultaneously live over real sockets, with disjoint socket, PID, and process-log paths.
- `v2/docs/daemon-host.md` states what keying actually scopes, replacing its current false claim that observation is scoped.

## Decisions

- Drive real daemon processes over real sockets; rules out asserting path strings as a substitute for coexistence.
- Prove coexistence under **one** shared temporary home, so path disjointness is attributable to digest keying and the test fails against fixed-socket code; rules out two homes, under which the test passes trivially.
- Do **not** scope `run list` / `run wait` by digest. Run state is keyed by `JARVIS_HOME`, not digest (`openStateStore` defaults to `<jarvisHome>/state/v2.sqlite`), and rows carry no digest column, so durable rows are shared across daemons under one home. Filtering by digest would hide a restarted daemon's own reconciled and auto-resumed rows, since any `v2/src/**` edit changes the digest. Rules out stamping run rows with the admitting daemon's digest under this intent; seed it separately if an operator ever needs it.
- Correct `v2/docs/daemon-host.md` rather than implement to its current text: socket, PID, and process-log paths are disjoint, and liveness plus live controls are scoped to the owning daemon, but durable run rows are shared under one home.
- Place the test in a `.sandbox-unrunnable.test.ts` file and the `test:integration:v2` scope; rules out adding real-process timing to the agent-runnable suite.
- Reap both daemons unconditionally, including on failure and timeout; rules out leaked daemons across test runs.
- Use temporary isolated home directories, not the operator's `~/.jarvis`; rules out any interaction with the operator's daemon.

## Acceptance criteria

- [ ] Two daemons keyed by different digests are live at the same time, with disjoint socket, PID, and process-log paths and no lifecycle error from the second start.
- [ ] Both daemons run under one shared temporary home, and the test fails against fixed-socket code, where the second start collides on the shared socket and PID.
- [ ] Neither daemon survives the test, on success or failure.
- [ ] `v2/docs/daemon-host.md` no longer claims observation is scoped by daemon, and states that durable run rows are shared across keyed daemons under one home.
- [ ] `bun run typecheck` and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — concurrently keyed daemons do not share socket, PID, or log paths; liveness and live controls are scoped to the owning daemon; durable run rows are shared under one home.

## Prerequisites

- Daemon socket, PID, and process-log paths are keyed by the invoking executable-tree digest.
