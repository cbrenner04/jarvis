# 02 - Documentation

## Problem

Durable docs still describe gate-command overrides as admitted onto workflow steps and consumed at finalization, but do not state that review and review-debate rows retain their own `fixCommand` and `readyCommand` on the workflow snapshot for continuation after live config edits.

## Decision ledger

- `v2/docs/write-behavior.md` owns continuation snapshot-field semantics; rules out duplicating the full list in `install-and-config.md`.
- `v2/docs/v1-behaviors.md` extends the existing per-project gate-command parity entry rather than adding a second catalog bullet; rules out a parallel v1-behavior row that only restates admission stamping.

## Task checklist

- Add review-row gate commands to the dispatch-time snapshot fields preserved across continuation in `v2/docs/write-behavior.md`.
- Update the v2 parity entry for per-project gate-command overrides in `v2/docs/v1-behaviors.md` to cover snapshot persistence and snapshot-backed continuation reconstruction.

## Acceptance criteria

- [ ] `v2/docs/write-behavior.md` lists `fixCommand` and `readyCommand` among snapshot-backed fields retained on review and review-debate rows across continuation.
- [ ] `v2/docs/v1-behaviors.md` records that review and review-debate workflow snapshots persist dispatch-time gate commands and that continuation reconstruction reads those snapshot values instead of live config.

## Documentation updates

- `v2/docs/write-behavior.md` — add review-row gate commands to the dispatch-time snapshot fields preserved across continuation.
- `v2/docs/v1-behaviors.md` — update the v2 parity entry for persisted review-step gate commands.
