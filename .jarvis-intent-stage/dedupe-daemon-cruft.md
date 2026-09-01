---
name: dedupe-daemon-cruft
---

# Deduplicate daemon helper and shrink-suffix cruft

## Primary implementation surface

Daemon

## Prerequisites

- State store opens a fresh database and upgrades the operator's pre-squash database to the baselined schema without data loss.
- Default SQLite store path is exported from `paths.ts` and persistence call sites no longer re-derive it inline.
- Persistence-layer `isRecord` and shrink-suffix checks import from canonical shared homes.

## Problem

Daemon code reimplements `isLoadError`, `sleep`, and `errorMessage`, hardcodes the hidden-shrink suffix as raw `~shrink` literals and `slice(0, -7)` (`daemon.ts:633-635`), and `ipc/server.ts` carries another `isRecord` copy.

## Behavior

- Migrate `daemon.ts` `isLoadError`, `daemon-process-log.ts` `sleep`/`errorMessage`, and `ipc/server.ts` `isRecord` to canonical shared or v2 util homes; delete local definitions.
- Replace hidden-shrink detection and step-id stripping in `daemon.ts` with the exported shrink suffix constant and `endsWith`/`strip` helpers.
- Remove the `daemon-wire.ts` legacy-row branch once persistence baseline load makes it redundant.

## Decision ledger

- Shrink suffix is one exported constant with helpers; rules out module-private constants plus raw literals and magic `slice` lengths.
- Shared homes follow `shared/` or v2 util placement per existing import-direction rules; rules out leaving daemon-local predicate copies.
- Behavior-preserving: write-loop resume reconstruction for hidden-shrink rows stays byte-identical; rules out changing which snapshot step binds to a `~shrink` run.

## Acceptance criteria

- [ ] `v2/src/daemon/daemon-resume.test.ts` hidden-shrink resume pins stay green.
- [ ] Grep finds no local `function isLoadError`, `function isRecord`, `function sleep`, or `function errorMessage` definitions under `v2/src/daemon/` or `v2/src/ipc/`.
- [ ] `daemon.ts` hidden-shrink handling uses the shared shrink helpers with no raw `~shrink` literal or `slice(0, -7)` reachable in production paths.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates
