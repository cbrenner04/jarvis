# Start patch escalation at declared tier

Known-hard specs should skip an unproductive cheap attempt without adding nondeterministic runtime classification.

## Decisions

- Store `tier: trivial|standard|hard` beside `repo:` in runnable `index.md` metadata, not in machine config; config would make one spec run differently by machine.
- Apply declared tiers to patch execution only; extending the new selector to plan, review, or prompt would invent consumers with different ladders.
- Add `jarvis run --tier <tier>` as a one-run override, not a metadata rewrite; an override must not mutate the recorded work classification.
- Map `trivial` to rung 0, `standard` to rung 1 capped at the final rung, and `hard` to the final rung; mapping all tiers to rung 0 defeats known-hard work, while a fixed third-rung mapping breaks shorter ladders.
- Preserve ordinary quota and no-progress advancement from the selected rung, not a tier-specific retry policy; a parallel policy would duplicate recovery semantics.
- Treat missing legacy metadata as `trivial` for compatibility, but new runnable specs record a tier; rejecting existing specs would break already-authored work.
- Do not infer or persist a tier at runtime; per-run selection would make execution non-deterministic.
- Deferred to first consumer: plan/intent tier stamping — pin when plan authoring needs to emit runnable-work metadata.

## Tasks

- Add index-metadata parsing and CLI validation for the three tier values and `--tier`.
- Start patch mode's active agent ladder at the resolved tier rung before its first invocation.
- Keep later quota and no-progress transitions on the remaining suffix of that ladder.
- Cover recorded tiers, override precedence, short ladders, invalid values, legacy metadata, and no inference with focused tests.

## Documentation updates

- Update the durable operator/workflow reference in `v2/docs/` with index syntax, `--tier`, rung mapping, patch-only scope, legacy default, and the no-inference boundary.
- Update `v2/docs/v1-behaviors.md` with the changed v1 patch-ladder behavior and sources.
- Cross-link the existing v1 patch-ladder operator docs to the durable tier behavior without duplicating it.

## Acceptance criteria

- [ ] A patch run with recorded `tier: trivial`, `standard`, or `hard` starts respectively at the first, second-or-final, or final configured `modes.patch.agentOrder` rung.
- [ ] `jarvis run --tier <tier>` selects that start rung for one patch run without changing the spec's recorded metadata.
- [ ] From a selected start rung, quota and no-progress results continue through only later configured rungs and terminal no-progress still exits 4 after the final available rung.
- [ ] A one-rung or two-rung agent order resolves every valid tier deterministically without an out-of-range attempt.
- [ ] Invalid recorded or CLI tier values fail before an agent invocation with accepted-value guidance.
- [ ] A legacy spec with no `tier:` retains first-rung behavior, and execution never infers or writes a tier from run results.
- [ ] Durable operator/workflow documentation states the syntax, override, mapping, patch-only scope, and deterministic boundary; `v2/docs/v1-behaviors.md` records the v1 behavior.
