# Start patch escalation at declared tier

Known-hard specs should skip an unproductive cheap attempt without adding nondeterministic runtime classification.

## Decisions

- Store an optional `tier: trivial|standard|hard` beside `repo:` in runnable `index.md` metadata, not in machine config; config would make one spec run differently by machine.
- A tier is one unindented `tier: <value>` line before the first checklist item; allow zero or one, reject duplicate or later `tier:` lines so durable metadata has one parse result.
- Accept only nonblank lowercase `trivial`, `standard`, or `hard` values in metadata and `--tier`; accepting aliases would make selection ambiguous.
- Apply declared tiers to patch execution only; extending the new selector to plan, review, or prompt would invent consumers with different ladders.
- Add `jarvis1 run --tier <tier>` as a one-run override, not a metadata rewrite; an override must not mutate the recorded work classification.
- Map `trivial` to rung 0, `standard` to rung 1 capped at the final rung, and `hard` to the final rung; mapping all tiers to rung 0 defeats known-hard work, while a fixed third-rung mapping breaks shorter ladders.
- Preserve ordinary quota and no-progress advancement from the selected rung, not a tier-specific retry policy; a parallel policy would duplicate recovery semantics.
- Treat absent metadata in legacy and newly authored specs as `trivial` until plan/intent stamping has a consumer; requiring a producer before it exists would block runnable specs.
- Do not infer or persist a tier at runtime; per-run selection would make execution non-deterministic.
- Preserve iteration-budget exit `5` separately from final-rung no-progress exit `4`; collapsing them would hide whether the ladder or budget stopped the run.
- Preserve model-config and generic failures as exit `3`, timeouts as exit `8`, and exhaustion of the selected ladder by quota as exit `2`; tiering must not rewrite terminal classes.
- Attribute iteration banners, telemetry, summaries, and terminal diagnostics to the selected entry; retaining a skipped first-rung model would misreport the actuator.
- Cover duplicate-free configured ladders only; duplicate agent entries are already rejected by configuration validation.
- Deferred to first consumer: plan/intent tier stamping — pin when plan authoring needs to emit runnable-work metadata.

## Tasks

- Add index-metadata parsing and CLI validation for the three tier values and `--tier`.
- Start patch mode's active agent ladder at the resolved tier rung before its first invocation.
- Keep later quota and no-progress transitions on the remaining suffix of that ladder.
- Preserve terminal exit classes and report the selected agent/model in iteration and terminal telemetry.
- Cover recorded tiers, override precedence, short ladders, metadata placement and duplicates, invalid values, tierless specs, terminal classes, selected-entry attribution, and no inference with focused tests.

## Documentation updates

- Document syntax, `jarvis1 run --tier <tier>`, mapping, patch-only scope, tierless default, and no-inference boundary in `v2/docs/v1-behaviors.md` under `## Commands and modes` → `### Patch-mode run workflow`.
- Cross-link `v1/docs/agents.md#agentorder-as-an-escalation-ladder` to that durable entry without duplicating it.

## Acceptance criteria

- [x] A patch run with recorded `tier: trivial`, `standard`, or `hard` starts respectively at the first, second-or-final, or final configured `modes.patch.agentOrder` rung.
- [x] `jarvis1 run --tier <tier>` selects that start rung for one patch run without changing the spec's recorded metadata.
- [x] A tier is optional index metadata: one unindented `tier: trivial|standard|hard` line before the first checklist item is accepted; blank, unknown, duplicate, or later `tier:` lines fail before an agent invocation with accepted-value guidance.
- [x] An invalid `jarvis1 run --tier <tier>` value fails before an agent invocation with accepted-value guidance.
- [x] From a selected start rung, quota and no-progress results continue through only later configured rungs; final-rung no-progress exits `4`, while iteration-budget exhaustion remains exit `5`.
- [x] A one-rung or two-rung agent order resolves every valid tier deterministically without an out-of-range attempt.
- [x] Model-config and generic failures exit `3`, timeouts exit `8`, and quota exhaustion across every remaining selected rung exits `2`.
- [x] Iteration banners, telemetry, summaries, and terminal diagnostics identify the agent/model actually selected by tier, never a skipped rung.
- [x] A tierless legacy or newly authored spec retains first-rung behavior, and execution never infers or writes a tier from run results.
- [x] `v2/docs/v1-behaviors.md` records the syntax, override, mapping, patch-only scope, tierless default, and deterministic boundary; `v1/docs/agents.md#agentorder-as-an-escalation-ladder` cross-links without duplicating it.
