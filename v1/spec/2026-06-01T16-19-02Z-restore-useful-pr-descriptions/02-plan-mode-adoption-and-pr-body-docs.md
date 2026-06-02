# 02 - Plan-mode adoption and PR-body docs

## Problem

- Plan mode still documents and ships an empty preserved narrative section plus plan-specific header prose.
- The intent requires one shared PR-description body shape across all modes.

## Decisions

- Make plan-mode PR-body generation consume the same shared PR-description fragment and body-shape validator as patch mode; do not keep a plan-only empty narrative contract.
- Keep plan-mode narrative preservation semantics aligned with patch mode so operators get one marker contract across modes; do not define mode-specific rewrite rules.
- Update durable PR-body docs only once plan mode also ships the shared shape; do not leave shared docs describing mixed old/new mode behavior after this subspec lands.
- Record the shipped cross-mode behavior in `v2/docs/v1-behaviors.md`, because existing v1 behavior changed and v2 parity review reads that catalog.

## Tasks

- [ ] Add the plan-mode PR-description generation path that calls the shared fragment and validates the returned `Description` + `Decisions:` shape.
- [ ] Update plan-mode PR-body assembly and rewrite logic to preserve human-owned narrative and regenerate the machine-owned block when no human narrative exists.
- [ ] Update plan-mode tests to cover the shared body shape and preservation contract.
- [ ] Add cross-mode coverage proving patch and plan both source their generated narrative from the same shared fragment.
- [ ] Update durable PR-body docs and the v1 behavior catalog to match the shipped cross-mode behavior.

## Acceptance criteria

- [ ] Plan-mode draft PR creation produces a body whose narrative section is a model-authored short description followed by `Decisions:` and an unordered list.
- [ ] Plan-mode PR rewrites preserve human-written narrative inside `jarvis:narrative` markers unchanged and regenerate the generated block when no human-owned narrative exists.
- [ ] Patch and plan tests prove both modes use the same shared PR-description fragment rather than separate prompt wording.
- [ ] Durable docs describe what is generated, what is preserved, and where human edits belong for both modes.
- [ ] `v2/docs/v1-behaviors.md` records the new shipped PR-body behavior and no longer describes patch-only generated rewrites or plan-mode empty narrative.

## Documentation updates

- [ ] Update `v1/docs/plan-mode.md` PR lifecycle and PR-body sections for generated `Description` + `Decisions:` plus narrative-preservation behavior.
- [ ] Update `v1/docs/worktrees-and-commits.md` PR-body section so its shared contract matches both modes after plan adoption.
- [ ] Update `v2/docs/v1-behaviors.md` PR-body bullets for patch and plan behavior.
