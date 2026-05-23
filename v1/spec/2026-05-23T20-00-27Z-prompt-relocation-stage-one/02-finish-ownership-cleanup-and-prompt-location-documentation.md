# 02 — Finish ownership cleanup and prompt-location documentation

## Problem

After the patch and plan prompt artifacts move, the tree still needs an
auditable ownership story. Reviewers should be able to tell which files are the
sole shared prompt artifacts, which files remain runtime loaders, and which
prompt surfaces are explicitly out of scope for this stage. The existing docs
currently point readers at v1-owned prompt paths, so they will become
misleading unless they are updated in the same pass.

## Scope

Finalize the relocation-only story across docs and code ownership boundaries
without introducing new renderer semantics. This includes deleting any stale
editable prompt copies left behind by the earlier slices, clarifying the shared
source-of-truth paths, and updating the operator/developer docs that currently
name the old prompt locations.

## Task checklist

- [ ] Verify that the final tree leaves one editable source of truth for each
      relocated artifact category:
      patch rules, patch stable instruction text, and each of the five plan
      templates.
- [ ] Remove any stale markdown prompt bodies from the old v1 locations that
      would otherwise leave two editable copies of the same prompt text.
- [ ] Keep runtime loader code in `v1/src/...` only where it still owns path
      resolution, interpolation, rewrite hooks, and rendering behavior.
- [ ] Update `v1/docs/agents.md` to describe the shared prompt source location
      and the exact categories moved in this stage.
- [ ] Update `v1/docs/run-loop.md` so its description of the patch-mode prompt
      and injected rules points at the shared source of truth rather than the
      legacy v1-owned files.
- [ ] Update `v1/docs/plan-mode.md` so any references to specific plan template
      paths reflect the shared prompt source and distinguish template ownership
      from v1 loader logic.
- [ ] State explicitly in the docs that this stage is relocation-only:
      no wording edits, no new prompt IDs, no registry validation expansion,
      no snapshot revision system, and no migration of interactive/operator
      prompts such as repository disambiguation.
- [ ] Keep the resulting diff reviewable as a relocation pass, with any loader
      logic changes limited to source-path rewiring or equivalent ownership
      cleanup.

## Acceptance criteria

- [ ] The final implementation tree is auditable as relocation-only, with the
      moved prompt text clearly separable from loader/path updates.
- [ ] The shared source-of-truth story is unambiguous for all seven relocated
      artifacts: patch rules, patch stable instruction text, and the five plan
      templates.
- [ ] `v1/docs/agents.md`, `v1/docs/run-loop.md`, and `v1/docs/plan-mode.md`
      all describe the new prompt ownership/location accurately.
- [ ] The docs explicitly call out which prompt categories moved in this stage
      and which prompt surfaces remain out of scope.
- [ ] No new prompt composition or rendering semantics are introduced while
      completing the cleanup and docs work.

## Documentation updates

- [ ] Update the prompt ownership and location guidance in
      `v1/docs/agents.md`, `v1/docs/run-loop.md`, and `v1/docs/plan-mode.md`
      to match the relocated shared prompt source.
