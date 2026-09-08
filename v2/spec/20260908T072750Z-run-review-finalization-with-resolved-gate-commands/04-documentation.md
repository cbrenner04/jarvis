# 04 - Documentation

## Problem

Durable docs still state or imply write-step-only gate-command propagation at finalization and omit configured-versus-default missing-command terminal evidence, while prerequisite specs stamped and snapshotted review-row commands without documenting gate-owning-step consumption.

## Decision ledger

- `v2/docs/write-behavior.md` owns gate-owning-step command resolution, continuation semantics, and missing-command source evidence; rules out duplicating the full propagation story in `install-and-config.md`.
- `v2/docs/v1-behaviors.md` extends the existing per-project gate-command parity entry rather than adding a parallel catalog bullet; rules out leaving the "terminal-publication gate does not consume them" delta stale after this fix.

## Task checklist

- Document that fresh dispatch and gate-only continuation finalization read `fixCommand`/`readyCommand` from the gate-owning step (review, review-debate, or write) and that missing-command terminal evidence records configured versus default source.
- Update the v2 parity entry to describe gate-owning-step propagation and snapshot-backed continuation invocation instead of write-step-only propagation.

## Acceptance criteria

- [ ] `v2/docs/write-behavior.md` documents project-keyed command resolution for gate-owning steps, continuation semantics, and configured-versus-default terminal evidence for `ready_gate_command_missing`.
- [ ] `v2/docs/v1-behaviors.md` records gate-owning-step propagation and snapshot-backed continuation invocation for per-project gate-command overrides.
- [ ] `bun run typecheck` passes.

## Documentation updates

- `v2/docs/write-behavior.md` — gate-owning-step command resolution, continuation semantics, configured-versus-default missing-command evidence.
- `v2/docs/v1-behaviors.md` — update the v2 parity entry from write-step-only propagation to gate-owning-step propagation and snapshot-backed continuation.
