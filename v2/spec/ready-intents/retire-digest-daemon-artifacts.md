---
name: retire-digest-daemon-artifacts
---

# Retire digest-keyed daemon artifacts

## Prerequisites

- Daemon upgrades hand off one stable public address: the incoming generation admits new work, the outgoing generation admits nothing new, finishes its owned work, and exits when idle.
- The stable daemon exposes each draining-generation run as live and routes run observation, waits, logs, and controls to its authoritative owner.
- The stable daemon exposes one complete pipeline namespace and routes every pipeline verb to the generation owning its live work.
- Every operator client locates daemon service only at the stable socket and uses stable PID/log paths, with no source-digest lookup or public multi-socket discovery.

## Module-boundary surface

- Cleanup's daemon lifecycle-artifact discovery, liveness classification, preview, and removal.

## Problem

Cleanup treats each digest-keyed `.sock`/`.pid`/`.log` triplet as a daemon lifecycle unit, discovers units from socket files, and cannot reap socketless PID/log pairs. Stable addressing removes the need for ongoing per-version artifacts but leaves the old accumulation to migrate safely.

## Behavior

- Cleanup preserves the active stable daemon lifecycle files and safely removes inert legacy digest-keyed artifacts without treating them as daemon service endpoints.

## Decision ledger

- Stop creating or classifying digest-keyed triplets as current daemon lifecycle units; the stable socket, PID, and log are the only public unit.
- Discover legacy artifacts from the union of keyed socket, PID, and log filenames so socketless pairs cannot survive forever.
- Reap a legacy unit only after proving no compatible live draining generation still owns it; rules out deleting the private route or evidence for work still draining.
- Preserve and report ambiguous or live legacy units; cleanup remains fail-closed and never kills a process to make artifacts removable.
- Keep dry-run and apply on the same revalidated candidate set, with stable lifecycle files excluded from removal.

## Acceptance criteria

- [ ] A cleanup test proves a socketless legacy keyed PID/log pair is discovered and removed when its recorded process is dead; it fails against the pre-fix socket-seeded enumeration.
- [ ] A cleanup test proves a live or ambiguously classified draining generation's legacy artifacts are preserved and reported.
- [ ] A cleanup test proves the stable socket, PID, and process log are never offered for removal while the stable daemon is serving.
- [ ] A cleanup test proves dry-run previews the same legacy units that apply revalidates and removes, including socketless units.
- [ ] A structural test proves cleanup may recognize legacy keyed artifact filenames for migration but never connects to them or uses their digest keys to locate daemon service.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — stable lifecycle files and legacy artifact migration behavior.
- `v2/docs/operator-runbook.md` — replace digest artifact reaping guidance with stable-file preservation and fail-closed legacy cleanup.
- `v2/docs/daemon-host.md` — lifecycle artifact ownership during and after draining.
- `v2/docs/v1-behaviors.md` — record retirement of per-digest artifact units and cleanup of legacy residue.
