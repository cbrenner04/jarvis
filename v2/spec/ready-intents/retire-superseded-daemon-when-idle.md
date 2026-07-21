---
name: retire-superseded-daemon-when-idle
---

# Retire a superseded daemon when idle

## Problem

- Digest-keyed daemons can overlap safely, but an older instance needs a bounded retirement lifecycle.

## Outcome

- When a new daemon takes over dispatch, older daemons finish owned runs, reject new work, and exit after becoming idle.

## Decisions

- Preserve each superseded daemon and its socket until its in-flight runs settle; rules out bounce, drain, or forced termination.
- Close fresh dispatch admission after supersession while retaining observation and live steering; rules out assigning new runs to the old daemon.
- Keep run ownership in the admitting daemon until completion; rules out migration or handoff of locks, child processes, and log sinks.
- Exit automatically at idle; rules out indefinite stale processes or an operator stop command.

## Acceptance criteria

- [ ] Starting a daemon for a new executable digest supersedes older live daemon instances.
- [ ] A superseded daemon rejects new work but continues serving observation and steering for owned runs.
- [ ] Every in-flight run reaches its normal outcome under its original daemon.
- [ ] The superseded daemon exits without operator action once it owns no in-flight run.
- [ ] Supersession does not migrate run ownership, worktree locks, agent processes, or log sinks.
- [ ] A regression test in `v2/src/daemon/daemon-lifecycle.test.ts` proves a superseded daemon retires only after its owned runs settle; it fails on baseline.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — supersession, admission closure, ownership, and idle exit.
- `v2/docs/write-behavior.md` — observable daemon lifecycle behavior.
- `v2/docs/operator-runbook.md` — overlapping daemon operation and retirement.
- `v2/docs/v1-behaviors.md` — record the changed lifecycle.

## Prerequisites

- Work dispatch starts or reuses only the daemon keyed by the invoking executable-tree digest.
