# `run list` renders the refusal cause and slot retry state

## Problem

`formatListRunRow` in `v2/src/commands/run.ts` renders 17 columns (`reason`/`retryable`/`nextAction`, mutation/publication detail, `message`) plus a conditional trailing dismissal marker, but nothing from the refusal cause fields added in the previous subspec, so an operator reading `jarvis run list` still sees one `gate_invocation_refused` row shape. `run wait` prints the structured result and must keep carrying the same fields.

## Decisions

- Append the cause and slot-retry columns after the existing `message` column and before the conditional dismissal marker; rules out inserting mid-row, which would shift every established column index.
- Render the slot column as `<count>/<bound>` and `-` when the cause is not `slot_contention`; rules out two separate columns for one fact.
- Cause cell renders `gateRefusalCause` verbatim, `-` for non-refusal rows; `legacy_unknown` renders `legacy_unknown` in the cause cell and `-` in the slot cell.

## Acceptance criteria

- [ ] `v2/src/commands/run.test.ts` proves `run list` renders the gate-refusal cause and, for a slot-contention refusal, its `<count>/<bound>` cell, with `-` in that cell for `ceiling_headroom` and `legacy_unknown` refusals and `-` in both cells for a non-refusal row; the test fails against the pre-fix row format.
- [ ] A test proves `run wait` output preserves the structured `gateRefusalCause`, `slotRedriveCount`, and `slotRedriveBound` fields for a refused row.
- [ ] Existing `v2/src/commands/run.test.ts` list/wait cases stay green (dismissal marker stays last).
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — § Concurrency: the cause/count output an operator reads off `run list`/`run wait`, and which cause needs `jarvis run resume` versus a possible automatic re-drive.
- `v2/docs/write-behavior.md` — the `jarvis run list` row-format table: append the two new columns; the documented column list matches `formatListRunRow` today (17 columns, dismissal marker aside), so state the new count from that function.
- `v2/docs/v1-behaviors.md` — record the extended v2 `run list` row format.
