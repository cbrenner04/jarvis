# Document bound diff-derived mutation verification

## Problem

Bounded killing-test execution, non-terminating mutant settlement, guaranteed restore, and applied-mutant sidecar diagnostics are operator- and parity-relevant behaviors with no durable home after subspecs 00–03.

## Decision ledger

- Document each concern in exactly one durable home per `v2/docs/documentation-standard.md`; cross-link, do not duplicate across the three targets.
- `write-behavior.md` owns verifier execution semantics; `operator-runbook.md` owns hung-child and sidecar inspection guidance; `v1-behaviors.md` owns v2 parity baseline entries; rules out scattering the same prose in spec checklists.

## Prerequisites

- Subspecs 00–03 land bounded execution, sidecar records, and `non_terminating_mutation_failed` settlement.

## Task checklist

- Update `v2/docs/write-behavior.md` § Diff-derived mutation verification: fixed 30-second per-candidate killing-test wall clock within the verifier ceiling, distinct `non-terminating-mutation` / `non_terminating_mutation_failed` outcome and resume semantics, restore-on-every-path guarantee, and per-candidate `.jarvis-diff-derived-mutations/` sidecar lifecycle.
- Update `v2/docs/operator-runbook.md` § Mutation verification (and cross-link Known gotchas if the hung-verifier-child note belongs there): a wedged verifier child presents as a live run with no agent; inspect `<worktree>/.jarvis-diff-derived-mutations/` before reading a dirty guard as agent work.
- Update `v2/docs/v1-behaviors.md` with bounded killing-test execution and guaranteed mutant restore entries for v2 parity review.

## Acceptance criteria

- [x] `v2/docs/write-behavior.md` documents the fixed 30-second per-candidate killing-test wall clock, distinct retryable `non_terminating_mutation_failed` completion outcome and resume semantics, restore-on-every-path guarantee, and per-candidate sidecar lifecycle under § Diff-derived mutation verification.
- [x] `v2/docs/operator-runbook.md` documents that a hung verifier child presents as a live run with no agent and that operators should inspect `<worktree>/.jarvis-diff-derived-mutations/` before treating a dirty guard as agent work.
- [x] `v2/docs/v1-behaviors.md` records bounded killing-test execution and guaranteed mutant restore for the v2 parity baseline.

## Documentation updates

- This subspec is documentation-only; the three files above are the deliverable.
