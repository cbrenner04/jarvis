# Floor-aware shrink actuator selection

The post-completion shrink actuator rebuilds its fallback bindings directly from
`modes.patch.agentOrder` (it does not reuse the iteration ladder), so it needs
the floor applied independently. Reuses the floor-filter helper from subspec 01.

## Decisions

- Apply the subspec-01 floor filter to `modes.patch.agentOrder` before building shrink bindings (`v1/src/modes/patch/shrink.ts`). Rules out shrink silently running a below-floor model the iteration ladder already excluded.
- Filtering at binding construction makes shrink's quota fallback floor-safe for the same reason as patch iteration: below-floor entries are absent from the binding list.
- Zero floor-eligible actuators ⇒ surface the named floor error (role `shrink actuation` + floor) and skip shrink; the run's completed outcome is preserved (no failure exit). Rules out failing an already-complete spec run just because shrink cannot meet the floor — shrink is an optional post-completion phase.

## Task checklist

- Filter `opts.config.modes.patch.agentOrder` through the floor helper before `createShrinkInvocationBinding` mapping (`v1/src/modes/patch/shrink.ts`).
- When the eligible set is empty, emit the named floor error and skip shrink without changing the run's exit outcome.
- Tests: shrink skips below-floor entries at selection and fallback; empty-eligible surfaces the named error and skips shrink while the run outcome stays complete; floor-unset path unchanged.
- Update `v2/docs/v1-behaviors.md` with shrink's floor-aware selection.

## Acceptance criteria

- [ ] With a floor set, the shrink actuator selects and falls back only among entries whose `capability >= floor`, never a below-floor model.
- [ ] When no `modes.patch.agentOrder` entry meets the floor, shrink is skipped with an error naming the shrink actuation role and the floor, and the already-complete run's outcome/exit is unchanged.
- [ ] With no `actuationCapabilityFloor` configured, shrink selection and fallback behavior is unchanged.
- [ ] `v2/docs/v1-behaviors.md` records the floor-aware shrink actuator behavior.

## Documentation updates

- `v2/docs/v1-behaviors.md`: floor-aware shrink actuator selection + empty-eligible skip.
