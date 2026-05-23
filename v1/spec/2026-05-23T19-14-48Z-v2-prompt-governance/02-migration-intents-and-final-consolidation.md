# 02 — Migration sequence, follow-on intents, and final consolidation

## Problem

The prompt-governance design is not complete until it spells out how the repo
moves from today's mixed prompt/runtime implementation to the shared `prompts/`
model without making prompt diffs unauditable. The intent already points toward
mechanically separate phases: a relocation-only extraction pass, a
renderer/registry/snapshot/revision pass, and a later optional composition pass
for steps like patch prompt assembly. This slice needs to lock that migration
sequence into the design and produce the follow-on implementation intents that
future work will execute.

## Scope

Finish `v2/spec/prompts.md` and create the follow-on implementation intents
under `v2/spec/wip-intents/` that the design recommends. This slice owns:

- the migration sequence and ordering rationale
- unresolved tradeoffs and risks
- the concrete follow-on implementation intents
- final consistency checks across the design doc and new intents

This slice should keep the implementation intents atomic and auditable. It
should not merge relocation, registry/snapshot support, and optional layered
composition into one broad follow-on. The default outcome should be two
immediate intents plus a documented later composition phase, unless the design
finds a third atomic intent that is clearly justified.
The final result should also remove ambiguity about the immediate intent set by
choosing exact filenames and scopes for those follow-ons.

## Primary sources

- `v2/spec/prompts.md`
- `v2/spec/v2-vision.md`
- `v2/spec/wip-v2-musings.md`
- `v1/src/modes/patch/prompt.ts`
- `v1/src/modes/plan/prompts/`
- `v1/src/agents/codex.ts`

## Task checklist

- [ ] Extend `v2/spec/prompts.md` with the migration sequence, explicitly
      describing three stages even if only two immediate follow-on intents are
      created:
      relocation-only extraction, renderer/registry/snapshot/revision support,
      and later optional adoption of layered composition for inline-assembled
      prompts such as the patch prompt body.
- [ ] Explain why the first extraction pass must be no-wording-change and
      no-composition-change so prompt diffs remain mechanically auditable.
- [ ] Record the v1 shared evolving prompt decision in the final design:
      `jarvis1` keeps reading the same shared prompt source as v2, and prompt
      wording changes follow the shared review and snapshot standards because
      they affect both engines.
- [ ] Add the unresolved risks/tradeoffs section covering at least:
      how much adapter-local wrapping remains acceptable, how quickly to adopt
      layered composition after relocation, and the future question of broader
      eval coverage beyond snapshots.
- [ ] Create at least two atomic follow-on intent files under
      `v2/spec/wip-intents/`:
      one for relocation-only extraction of current v1 prompt artifacts into
      shared prompt source, and one for prompt registry/renderer/snapshot/
      revision support.
- [ ] Pick exact filenames for those immediate follow-on intents in the design
      rather than leaving naming to later authors. Unless the design finds a
      better conservative scheme, use one relocation-focused file and one
      registry/renderer-focused file whose basenames make their scope obvious.
- [ ] Ensure the extraction intent is explicit about its no-wording-change,
      no-new-composition-semantics posture and names the artifacts it moves.
- [ ] Ensure the extraction intent names the current v1 artifacts concretely:
      patch `rules.md`, the stable prompt text currently assembled in
      `v1/src/modes/patch/prompt.ts`, and the plan prompt templates
      (`refine`, `name-only`, `draft`, `review`, `inline-draft`).
- [ ] Ensure the renderer/snapshot intent covers ID lookup, revision-aware
      snapshots, validation failures for duplicate/missing/unknown IDs, and
      deterministic tests for ordering, overrides, placeholders, delimiters,
      non-recursive substitution, and wrapper selection.
- [ ] Decide whether to create a third optional intent for layered fragment
      composition adoption now or to leave that step documented only in
      `v2/spec/prompts.md` as a later follow-on once relocation and registry
      support land.
- [ ] If the composition step is left as design-only follow-on, say so
      explicitly in both the design doc and this spec tree rather than leaving
      the omission ambiguous.
- [ ] If the design chooses to create a third immediate intent for layered
      composition, require it to justify why composition cannot wait until
      relocation and registry support land and why that work remains atomic.
- [ ] Do a final pass on `v2/spec/prompts.md` so it includes every section
      promised by the original intent:
      prompt inventory, directory/layout, shared-evolving v1 decision, prompt
      taxonomy, rendering rules, review and rendered-snapshot expectations,
      versioning, migration sequence, and unresolved risks/tradeoffs.

## Acceptance criteria

- [x] `v2/spec/prompts.md` defines a staged migration plan that keeps
      relocation-only extraction mechanically separate from renderer/versioning
      work and from any later layered-composition adoption.
- [x] The final design doc explicitly records that `jarvis1` and v2 share one
      evolving prompt source of truth and that prompt wording changes remain
      reviewable shared behavior changes.
- [x] `v2/spec/prompts.md` includes an unresolved risks/tradeoffs section that
      matches the scope of the intent without reopening already-decided
      questions such as top-level shared `prompts/`.
- [x] `v2/spec/wip-intents/` contains the follow-on implementation intents
      required by the design, with relocation-only extraction and
      renderer/registry/snapshot/revision work separated into distinct,
      testable intents.
- [x] The immediate follow-on intent set has exact filenames and clearly
      bounded scopes, so later spec authors do not have to infer whether a
      given task belongs to relocation, registry/rendering, or deferred
      composition work.
- [x] Each new follow-on intent is atomic, names the files or surfaces it owns,
      and includes acceptance criteria and documentation updates suitable for a
      future implementation tree.
- [x] The spec either creates a third layered-composition intent with a clear
      reason, or explicitly defers that work to a later tree after relocation
      and registry support land.
- [x] The completed design doc covers all sections promised by the original
      intent and refine turns without duplicating `v2/spec/v1-behaviors.md`.

## Documentation updates

- [ ] Finish `v2/spec/prompts.md` and create the follow-on implementation
      intent files under `v2/spec/wip-intents/`.
