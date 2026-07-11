# Retain the resolved review behavior on list rows

Implement rows already carry the retained `reviewPasses` from the durable
workflow snapshot. The resolved review behavior must travel the same way, so
list/TUI consumers report what a run actually did rather than what config says
now.

## Decisions

- Persist the resolved behavior in the workflow snapshot at launch and copy it onto `list` rows next to `reviewPasses` — rules out re-deriving it from live project config, which can change mid-run.
- Emit `reviewBehavior` only on implement workflow rows, omitted (not `null`) elsewhere, mirroring `reviewPasses` — rules out a field that consumers must special-case.
- Emit it on review-free implement launches too, since the behavior is resolved regardless of pass count — rules out an absent field that reads as "unknown behavior".

## Task checklist

- [ ] Retain the resolved behavior on the durable workflow snapshot.
- [ ] Surface it on `list` rows and in TUI run data.

## Acceptance criteria

- [ ] `list` rows for an implement workflow run carry `reviewBehavior` (`"debate"` or `"light"`) matching the behavior resolved at launch, sourced from the durable workflow snapshot rather than live project configuration.
- [ ] Non-implement workflow rows omit `reviewBehavior` entirely.
- [ ] TUI run data exposes the same field on each `list` row.
- [ ] `tui-monitor-lines.test.ts` implement `reviewPasses` retention coverage stays green (behavior unchanged for the existing field).

## Documentation updates

- `v2/docs/daemon-host.md`: extend the implement review selection list-row section with `reviewBehavior`.
