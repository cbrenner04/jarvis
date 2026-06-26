# Capability rank + floor config schema

Establish a well-defined way to rank actuation model capability and a single
floor knob, so later subspecs can skip below-floor entries. Config + validation
only; no selection behavior yet (first consumer is subspec 01).

## Decisions

- Capability rank is an operator-assigned number per agent-order entry: `AgentEntry.capability?: number`, higher = more capable. Rank only needs ordering, so any finite number is accepted (no integer constraint). Rules out deriving rank from ladder position (the ladder is a cost/fallback ordering — default puts the cheapest model first, so position is not capability) and rules out a separate model→rank registry that could drift from `agentOrder`.
- "Below floor" is defined by plain numeric comparison: an entry is below-floor iff `entry.capability < floor`. Rules out named capability tiers, which would need their own ordered-name registry.
- Floor lives on the actuation mode: `modes.patch.actuationCapabilityFloor?: number`. Rules out a global floor — the intent scopes the floor to actuation roles, all of which resolve from `modes.patch.agentOrder`.
- Floor absent ⇒ feature off, selection unchanged. Backward-compatible; rules out a default floor that would silently change existing runs.
- When the floor is set, every entry in `modes.patch.agentOrder` must carry a numeric `capability`; a missing one is a load-time error naming the entry index. Rules out treating missing capability as an implicit 0/below-floor, which would make "below floor" ill-defined and silently drop agents.
- `capability` is ignored on non-actuation orders (`plan`/`prompt`/`review`); validated for type only when present. Rules out forcing operators to rank models for modes the floor does not govern.

## Task checklist

- Add optional `capability?: number` to `AgentEntry` (`v1/src/config.ts`).
- Validate `capability` is a finite number when present (in `validateAgentOrder`).
- Add `actuationCapabilityFloor?: number` to `modes.patch` (`ModeConfig` or a patch-specific field); validate it is a finite number when present.
- Enforce the coupling: floor set ⇒ each `modes.patch.agentOrder` entry has a numeric `capability`, else a named load error.
- Document the keys and the ranking convention in `v1/docs/config.md`.

## Acceptance criteria

- [ ] A config whose `modes.patch.agentOrder` entries each carry a numeric `capability` and that sets `modes.patch.actuationCapabilityFloor` loads without error.
- [ ] A config that omits `actuationCapabilityFloor` loads unchanged whether or not entries carry `capability` (feature off).
- [ ] Setting `actuationCapabilityFloor` while any `modes.patch.agentOrder` entry lacks a numeric `capability` fails config load with an error naming the offending entry.
- [ ] A non-numeric `capability` or non-numeric `actuationCapabilityFloor` fails config load with a field-named error.
- [ ] `v1/docs/config.md` documents `capability`, `actuationCapabilityFloor`, and that higher `capability` means more capable / below-floor is `capability < floor`.

## Documentation updates

- `v1/docs/config.md`: new `capability` and `actuationCapabilityFloor` keys; ranking convention.
