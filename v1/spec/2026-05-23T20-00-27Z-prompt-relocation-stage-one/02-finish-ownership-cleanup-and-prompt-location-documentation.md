# 02 — Finish ownership cleanup and prompt-location documentation

## Problem

After the patch and plan prompt artifacts move, the remaining work is to make
the ownership story explicit for humans. Reviewers and future contributors
should be able to see, in docs, which files are the sole shared prompt
artifacts under the repo-level `prompts/` tree, which files remain runtime
loaders, and which prompt surfaces are explicitly out of scope for this stage.
The existing docs currently point readers at v1-owned prompt paths, so they
will become misleading unless they are updated in the same pass.

## Scope

Document the completed relocation clearly once the code-moving slices have
landed, without introducing new renderer semantics. This slice is a
cross-cutting audit-and-docs pass: it should verify the final ownership story,
update the operator/developer docs that currently name the old prompt
locations, and make the out-of-scope boundaries explicit. It should not become
a second implementation slice for moving prompt bodies.

## Primary sources

- `v1/docs/agents.md`
- `v1/docs/run-loop.md`
- `v1/docs/plan-mode.md`
- `v2/spec/prompts.md`
- outputs of subspecs 00 and 01

## Task checklist

- [ ] Verify that slices 00 and 01 leave one editable source of truth for each
      relocated artifact:
      patch rules, patch stable instruction text, and the five plan templates.
- [ ] Verify that the old v1 paths no longer act as editable prompt-text homes
      and that the remaining `v1/src/...` files are clearly loader/runtime
      code.
- [ ] Update `v1/docs/agents.md` to describe the shared repo-level `prompts/`
      source location and the exact categories moved in this stage.
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
- [ ] Keep this slice reviewable as an audit-and-docs pass rather than a new
      prompt-migration implementation slice.

## Acceptance criteria

- [ ] The final implementation tree is auditable as relocation-only, with the
      moved prompt text clearly separable from loader/path updates.
- [ ] The shared source-of-truth story is unambiguous for all seven relocated
      artifacts under the top-level `prompts/` tree:
      patch rules, patch stable instruction text, and the five plan templates.
- [ ] `v1/docs/agents.md`, `v1/docs/run-loop.md`, and `v1/docs/plan-mode.md`
      all describe the new prompt ownership/location accurately.
- [ ] The docs explicitly call out which prompt categories moved in this stage
      and which prompt surfaces remain out of scope.
- [ ] The docs distinguish the shared `prompts/` text artifacts from the
      remaining v1 loader/runtime files that still live under `v1/src/...`.
- [ ] No new prompt composition or rendering semantics are introduced while
      completing the audit and docs work.

## Documentation updates

- [ ] Update the prompt ownership and location guidance in
      `v1/docs/agents.md`, `v1/docs/run-loop.md`, and `v1/docs/plan-mode.md`
      to match the relocated shared `prompts/` source.
