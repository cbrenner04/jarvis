# Config schema for per-sub-role agent orders

## Problem

A patch run drives three sub-roles that currently cannot tier independently:

- **review panel** — read-only roles adversary/advocate/adjudicator
  (`resolveReviewAgentOrder`: `modes.review.agentOrder ?? modes.plan.agentOrder`)
- **review actuator** — the verdict actuator and the shrink agent
  (`modes.patch.agentOrder`)
- **patch actuator** — the implementation loop (`modes.patch.agentOrder`)

The review actuator and patch actuator both resolve from
`modes.patch.agentOrder`, so an operator cannot assign them different orders.
Note they consume that order differently: the verdict actuator reads only the
head's model (`modes.patch.agentOrder[0]?.model` in `review.ts`), while the
shrink agent and patch loop iterate the full list for quota fallback. This
subspec adds the config surface for per-sub-role overrides; wiring lands in
`01`.

## Decisions

- Config shape: one optional block `modes.patch.subRoleAgentOrder` with three
  optional keys — `reviewPanel`, `reviewActuator`, `patchActuator` — each an
  agent order. Rules out the asymmetric alternative of adding a single
  `reviewActuator` key while leaving the other two implicit; the intent
  describes one uniform override mechanism across all three sub-roles, so a
  symmetric block reads the same way the behavior does.
- Block lives under `modes.patch` (not a top-level config key): all three
  sub-roles execute during a patch run, so patch is their natural home. Rules
  out a top-level `subRoleAgentOrder` sibling of `modes`, which would read as
  global and invite applying it to standalone `jarvis review` / plan self-review
  — out of scope here.
- Each present key validates through the existing `validateAgentOrder` contract
  (known agents, no duplicates, valid model per agent). Rules out a looser bespoke
  validator that would let a malformed sub-role order reach runtime.
- The block and every key are optional; an absent block or absent key is valid
  and changes nothing (fallback semantics defined in `01`). Rules out requiring
  the block, which would break every existing config.
- Unknown keys under `subRoleAgentOrder` fail config load with a named error.
  Rules out silently ignoring a typo'd sub-role name, which would leave an
  operator believing a tier was applied when it was not. This is intentionally
  stricter than the lenient `modes.patch` parent (which tolerates unknown keys):
  a dropped sub-role tier is silent and costly, where a stray unknown key on
  `modes.patch` is harmless, so the child warrants hard failure the parent does
  not.
- Field location: `subRoleAgentOrder` lives on the patch `ModeConfig`, alongside
  the existing patch-only `shrink` field. Rules out a separate patch-only type,
  which would fragment patch config for no gain since `ModeConfig` already
  carries patch-only fields.

## Task checklist

- Add an optional `subRoleAgentOrder` field to the patch `ModeConfig` typed as a
  partial map of `reviewPanel` / `reviewActuator` / `patchActuator` to
  `AgentEntry[]`.
- Validate the block at config load: each present key runs the
  `validateAgentOrder` contract under a field name like
  `modes.patch.subRoleAgentOrder.<key>`; unknown keys fail with a named error;
  absent block/keys are accepted.
- Confirm an absent block round-trips and that `loadConfig` on today's configs
  is unchanged.
- Update `v1/docs/config.md`: document `modes.patch.subRoleAgentOrder`, its keys,
  optionality, and that unset preserves current resolution.

## Acceptance criteria

- [ ] A config with `modes.patch.subRoleAgentOrder` setting any of `reviewPanel`,
      `reviewActuator`, `patchActuator` to a valid agent order loads successfully
      and exposes those orders on the loaded config.
- [ ] A config omitting `subRoleAgentOrder` (or omitting individual keys) loads
      successfully; existing config fixtures/tests stay green (schema addition is
      additive).
- [ ] A `subRoleAgentOrder` key whose value violates the agent-order contract
      (unknown agent, duplicate agent, or invalid model) fails config load with an
      error naming `modes.patch.subRoleAgentOrder.<key>`.
- [ ] An unknown key under `subRoleAgentOrder` fails config load with an error
      naming the offending key.
- [ ] `v1/docs/config.md` documents `modes.patch.subRoleAgentOrder`, its three
      keys, optionality, and that an unset block leaves resolution at today's
      behavior.

## Documentation updates

- `v1/docs/config.md` — new `modes.patch.subRoleAgentOrder` block.
