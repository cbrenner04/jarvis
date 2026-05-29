---
name: prompt-layering-reconcile
---
# Reconcile prompt frontmatter to the layering vocabulary, then ship layering

Caught while reviewing the Phase 1 first-write-step PR. The shipped prompt
registry (#121/#122) drifted from the layering contract designed in
`v2/docs/prompts.md` / `v1/docs/prompt-governance.md`, and the drift silently
blocks the layered composition we still want. Fix the schema, then ship the
renderer the docs designed but never landed. Run this before Phase 5 (workflow
runner), so the prompt vocabulary is honest before workflows depend on it.

## The drift

Every artifact in the registry seed list uses off-vocabulary frontmatter:

- `behavior: agent-facing` — `agent-facing` is not a behavior. It's the surface
  bucket, and it's the registry's *entire scope* (human-facing chooser/confirm
  strings are deliberately kept in runtime TS, excluded from the registry per
  the governance doc). So the field is tautological on every artifact and
  carries no grouping information.
- `kind: template` / `kind: rules` — not the designed `step | fragment`. The
  renderer can't dispatch `global → behavior → step` without a real `kind`.
- `description:` exists but isn't in the documented schema; `placeholders` is a
  flat `[NAME:string!]` list rather than the documented `{type, required}` map.

`prompts.md` already carries a banner admitting this drift; it was annotated,
never reconciled.

## What to do

1. Reconcile frontmatter to the vocabulary the renderer needs:
   - `kind: step | fragment` (real), plus a `global` tier marker so global
     fragments are identifiable.
   - `behavior` becomes the real grouping key. **Drop `agent-facing`** — the
     registry is agent-bound by construction, so the surface label is redundant.
   - Decide what to do with `description` and the placeholder list form
     (reconcile to the documented map, or bless the shipped form in the doc).
2. Ship the layered renderer the docs designed but #121/#122 skipped:
   `global fragments → behavior fragments → step body`, with the `add`/`remove`
   override semantics. First consumer is the `write` prompt the moment it stops
   being the trivial Phase 1 body and needs to layer in `global/terse` — so the
   renderer is not built consumer-less.
3. Keep `jarvis1` green: it reads the same shared source, so this is a shared
   behavior change. Cover with the rendered-prompt snapshots.

## Decisions already made (don't relitigate in refinement)

- **Keep the behavior set as-is.** We don't think `{write, review-and-update,
  human}` is quite right yet, and `plan`/`patch` artifacts don't map cleanly
  onto it — but that's a separate problem. This intent fixes the *mechanism*
  (kind + grouping + renderer), not the behavior taxonomy.
- **No human-facing axis in the per-artifact schema.** No artifact needs it and
  the design keeps human-facing text in code. Defer to a real consumer; if one
  ever lands, give it its own field or its own registry then.
- **Don't conflate the `human` behavior with "human-facing."** The human-loop
  (pause/approve/revise) is runner-bound orchestration and would get
  `behavior: human` like anything else — different axis from chooser strings.
- Approach (a): reconcile schema *and* ship the renderer in this work, with the
  write prompt as the renderer's first consumer. Not schema-only.

## Watch for

- The renderer is the over-build risk. If refinement/draft can't name a concrete
  layered step it serves, shrink scope back toward schema-reconcile-only and
  defer the renderer to the step that needs it.
- `revision` bump rules: a frontmatter-semantics change that alters rendered
  output bumps revision; a pure relabel that doesn't change rendered text does
  not. Get this right per artifact so snapshot diffs stay auditable.

## Refinement

- Durable contract home is `v1/docs/prompt-governance.md`; update it as the canonical shipped schema/renderer spec because `v2/docs/prompts.md` marks itself historical where the two disagree.
- `v2/docs/prompts.md` still needs alignment in the same subspec, but only as historical context plus cross-links; do not leave it carrying an alternate live contract.
- Concrete first consumer is `patch.prompt.body`; this supersedes the generic "write prompt" wording because the shipped registry/runtime/test IDs are `patch.*`, not a `write.*` vocabulary.
- Scope includes the shared registry/runtime/tests that currently encode drift: `v1/src/prompts/registry.ts`, `v1/src/prompts/renderer.ts`, `v1/test/prompts/registry.test.ts`, `v1/test/prompts/renderer.test.ts`, and rendered snapshot coverage.
- Keep rollout scope to artifacts already in the first registry rollout; do not pull `plan/name-only.md` or `plan/inline-draft.md` into this subspec because `v1/docs/prompt-governance.md` explicitly defers them.
- Reconcile schema by replacing `kind: template|rules` with `kind: step|fragment` across registered artifacts and validation/tests; no compatibility alias layer unless an existing caller outside the registry load path requires it.
- Reconcile grouping by making `behavior` carry the real behavior class on non-global artifacts and by introducing an explicit global-tier marker for global fragments; do not keep `agent-facing` as stored artifact metadata.
- Decide one placeholder contract and use it end-to-end in docs, parser, fixtures, and prompt files; partial dual-format acceptance would preserve the drift the subspec is meant to remove.
- Placeholder delimiter syntax is part of the same contract surface because `v2/docs/prompts.md` still documents `{{name}}` while shipped tests/files use `<NAME>`; either reconcile docs to shipped syntax or migrate the files/runtime in this same slice.
- Prefer the narrowest global-tier encoding that makes `global -> behavior -> step` assembly unambiguous; Deferred to first consumer: exact field shape for the global marker — pin when the renderer/registry implementation chooses the least-invasive form.
- Preserve current deferred human-facing boundary: chooser/confirmation strings remain runtime-owned and out of registry scope in this subspec.
- Treat `plan.decisions-ledger` and `plan.defer-to-consumer` as behavior-tier plan fragments in the shipped contract, not as globals; current builder wiring is an implementation shortcut, not vocabulary to preserve.
- Ship metadata-driven composition, not caller-owned fragment lists: step metadata plus registry grouping must let builders ask for a step ID and placeholder values, not restate `global -> behavior -> add/remove` membership in TS.
- Keep `patch.rules` as step-owned injected body content unless the renderer needs fragment semantics for a concrete consumer; no speculative promotion to a shared fragment tier.
- Rendered snapshot review remains assembled-output focused; update shared-body snapshots and wrapper snapshots only where rendered output or wrapper composition actually changes.
- Revision bumps are per artifact ID, not a registry-wide sweep; artifacts whose rendered output is byte-identical after metadata relabeling keep their current revision.
- Draft should split work if schema reconciliation and renderer shipment stop being independently reviewable in one subspec; current one-slice justification is that both touch the same prompt contract and the same snapshot surface.
- Preserve the shipped first-rollout fragment inventory and order unless the concrete `patch.prompt.body` consumer proves a different order is required: patch globals stay `global.documentation -> global.naming -> global.terse`; plan layering stays `global.documentation -> global.terse -> plan.decisions-ledger -> plan.defer-to-consumer`.
- Keep runtime lookup and composition keyed by prompt `id`, not by prompt file path or legacy `prompts/fragments|steps` directory taxonomy from `v2/docs/prompts.md`; the historical doc's layout example is context, not a contract to resurrect.
- Preserve the existing validation split unless a concrete failing caller forces otherwise: metadata/relationship/schema errors stay registry-load failures; unknown runtime IDs and placeholder-value errors stay render-time failures.
