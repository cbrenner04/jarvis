# Retain the resolved review behavior on list rows

Implement rows already carry the retained `reviewPasses` from the durable
workflow snapshot. The resolved review behavior must travel the same way, so
list/TUI consumers report what a run actually did rather than what config says
now.

## Decisions

- Thread the resolved behavior from the implement workflow input into the durable workflow snapshot as an explicit snapshot-level field, written at launch, and read it back onto `list` rows — rules out deriving it from the emitted review step the way `reviewPasses` is derived, which cannot work: a review-free launch emits no review step to read, and `reviewPasses` reports zero there precisely because of that derivation. Also rules out re-deriving from live project config, which can change mid-run.
- Emit `reviewBehavior` only on implement workflow rows, omitted (not `null`) elsewhere — rules out a field that consumers must special-case.
- Emit it on review-free implement launches too, since the behavior is resolved regardless of pass count — rules out an absent field that reads as "unknown behavior".

## Task checklist

- [x] Carry the resolved behavior from the implement workflow input onto the durable workflow snapshot as an explicit field.
- [x] Surface it on `list` rows and in TUI run data.

## Acceptance criteria

- [x] `list` rows for an implement workflow run carry `reviewBehavior` (`"debate"` or `"light"`) matching the behavior resolved at launch, sourced from the durable workflow snapshot rather than live project configuration or the emitted step list.
- [x] A review-free implement launch (zero resolved passes, no review step emitted) still carries the resolved `reviewBehavior` on its `list` rows.
- [x] Non-implement workflow rows omit `reviewBehavior` entirely.
- [x] TUI run data exposes the same field on each `list` row.
- [x] `tui-monitor-lines.test.ts` implement `reviewPasses` retention coverage stays green (behavior unchanged for the existing field).

## Documentation updates

- `v2/docs/daemon-host.md`: extend the implement review selection list-row section with `reviewBehavior`.
