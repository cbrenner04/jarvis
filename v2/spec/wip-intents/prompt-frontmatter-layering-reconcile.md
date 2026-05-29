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
