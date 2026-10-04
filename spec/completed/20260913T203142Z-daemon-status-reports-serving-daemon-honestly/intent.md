---
name: daemon-status-reports-serving-daemon-honestly
---

# `daemon status` reports the serving daemon honestly

## Prerequisites

## Primary implementation surface

- `v2/src/commands/daemon-lifecycle.ts` (daemon status verdict and rendering)

## Problem

`daemon status` decides with `loadedExecutableDigest === currentExecutableDigest` but displays `loadedRevision`/`currentRevision` (git `HEAD` commits). Observed 2026-09-11: `running loaded=a5624c9 current=65f6dab` after a spec-only merge that cannot rotate the key (`EXECUTABLE_TREE_PATHSPECS` covers only `v2/src`, `shared`, build config). Operators read normal operation as staleness and bounce for nothing. A reachable daemon on the stable socket with a different loaded digest can also be reported `stopped`/stale.

## Behavior

- `daemon status` prints `running` and exits zero whenever a daemon serves the stable socket, regardless of loaded executable digest.
- Under `running`, status prints only the serving daemon's own loaded identity (e.g. `loaded=<digest-or-revision>`); it never prints a separate "current" identifier and never compares the two to decide or display staleness.

## Acceptance criteria

- [ ] A CLI lifecycle test proves `daemon status` prints `running` and exits zero while a daemon serves the stable socket with a different loaded executable digest; it fails against the pre-fix digest-scoped probe/stale result.
- [ ] A CLI lifecycle test proves `daemon status` never renders two differing identifiers alongside a `running` verdict; it fails against the pre-fix `loadedRevision`/`currentRevision` rendering.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — status semantics.
- `v2/docs/operator-runbook.md` — drop guidance reading loaded/current revision mismatch as staleness.
- `v2/docs/v1-behaviors.md` — status behavior change, if listed.
