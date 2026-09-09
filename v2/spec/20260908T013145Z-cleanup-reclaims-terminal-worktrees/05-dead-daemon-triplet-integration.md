# 05 - Verify dead daemon triplet in unified cleanup invocation

## Problem

The prerequisite keyed-daemon triplet classification must remain wired through the unified cleanup invocation so one preview and apply pass reports and removes every dead `.sock`, `.pid`, and `.log` companion without regressing to socket-only integration.

## Decision ledger

- Consume the prerequisite `reapDeadDaemonSockets` triplet contract from `20260907T171608Z-cleanup-reaps-dead-daemon-companions`; rules out re-implementing socket-only reaping in this spec.
- One cleanup invocation previews and applies all dead digest companions alongside the other slices; rules out a separate daemon-only cleanup entry point.
- Live and ambiguously probed triplets stay preserved through the existing fail-safe classification; rules out changing liveness probes in this spec.

## Work

- Confirm `gatherCleanupDiscoveryContext` / `executeConfirmedCleanup` still call `reapDeadDaemonSockets` and `removeDeadDaemonArtifacts` for the full triplet set.
- Pin regression coverage via the existing unified cleanup triplet test.
- Align operator and parity docs with the prerequisite triplet behavior in the unified cleanup contract.

## Acceptance criteria

- [x] `v2/src/commands/cleanup.test.ts` test `dead daemon digest reaps socket pid and log` stays green.
- [x] `v2/docs/operator-runbook.md` cross-links dead daemon digest triplet preview, apply, and fail-safe preservation within the unified cleanup invocation.
- [x] `v2/docs/v1-behaviors.md` records that unified cleanup reaps dead daemon digest triplets per the prerequisite contract.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/operator-runbook.md` — daemon companion integration within the unified cleanup invocation.
- `v2/docs/v1-behaviors.md` — unified cleanup dead daemon triplet lifecycle aligned with prerequisite spec.
