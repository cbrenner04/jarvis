---
name: daemon-status-preserves-inconclusive-liveness
---

# Preserve inconclusive daemon liveness in `daemon status`

Unsplit rationale: The seed changes one atomic `daemon status` read contract; its lifecycle classification, CLI rendering, regression tests, and durable documentation cannot land independently without an inconsistent status result.

## Primary implementation surface

- `daemon status` read path (`v2/src/daemon/daemon-lifecycle.ts` through `v2/src/commands/daemon.ts`)

## Problem

`getDaemonStatus` collapses every failed one-second health probe into `stopped`, so a healthy daemon with a busy event loop can trigger destructive dead-daemon recovery.

## Behavior

- Status uses the shared socket-liveness classification instead of a second boolean liveness vocabulary.
- A health timeout gets one longer retry. If the socket remains live but health still misses the budget, status reports an inconclusive state naming the timeout and exhausted probe budget, never `stopped`.
- Only positive dead-socket evidence reports `stopped`; an answered health request still reports `running` with existing revision reporting unchanged.
- Inconclusive CLI output is visibly distinct from `stopped`, exits nonzero, and is not grounds for `kill -9` or starting another daemon.
- `daemon start`, `daemon stop`, and executable-revision comparison behavior do not change.

## Decisions

- Treat timeout as uncertainty, not death; rules out destructive recovery from an unlucky sample.
- Retry once at a longer budget before returning an inconclusive verdict; rules out unbounded polling and single-sample authority.
- Reuse `probeSocketLiveness`; rules out another classifier that can drift from cleanup and bind safety.
- Keep the change within status observation; rules out changing lifecycle mutation commands or revision semantics.

## Acceptance criteria

- [ ] A regression test keeps a socket accepting connections while its health RPC exceeds the short budget and proves status does not report `stopped`; it fails against the pre-fix boolean-probe mapping.
- [ ] A test proves a health timeout is retried exactly once with a longer budget before an inconclusive verdict.
- [ ] A command test proves the inconclusive output names the timeout and exhausted budget and is visibly distinct from a positively dead daemon.
- [ ] Tests prove a genuinely dead socket still reports `stopped` and an answered health request still reports `running` with existing revision output unchanged.
- [ ] Existing `v2/src/commands/daemon.test.ts` start/stop tests stay green (behavior unchanged).
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — define `stopped` as positive dead-socket evidence, make inconclusive status unsafe for destructive recovery, and retire the busy-daemon-reads-stopped note.
- `v2/docs/daemon-host.md` — document status classification, bounded retry, and the shared liveness vocabulary used by status and cleanup.
- `v2/docs/write-behavior.md` — document the inconclusive output and exit contract without changing running revision output.
- `v2/docs/v1-behaviors.md` — record the changed v2 status behavior.

## Prerequisites

- `probeSocketLiveness` conservatively classifies socket paths as live, stale, or absent and does not treat a timeout as proof of death.
