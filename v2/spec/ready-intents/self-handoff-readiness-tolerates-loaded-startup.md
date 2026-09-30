---
name: self-handoff-readiness-tolerates-loaded-startup
---

# Self-handoff successor startup tolerates loaded-machine readiness latency

## Problem

Self-handoff spawns a successor through `startDaemon` with the default 5s readiness bound; under load the successor can still be making progress when the bound kills it, triggering rollback and the admission/backoff failure chain.

## Decisions

- Self-handoff passes an explicit readiness bound larger than `DEFAULT_DAEMON_READINESS_TIMEOUT_MS`; manual `daemon start` keeps the default.
- The handoff fallback timer stays longer than the self-handoff readiness bound so slow-but-live successors are not rolled back first.

## Acceptance criteria

- [ ] A unit regression with a fake readiness prober proves a live self-handoff successor that becomes ready after 5s still commits; it fails against the pre-fix code.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — autonomous self-handoff readiness bound under load.
- `v2/docs/v1-behaviors.md` — `[v2-only]` autonomous self-handoff bullet: explicit readiness bound above the default `startDaemon` budget.

## Prerequisites
