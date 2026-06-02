# 00 - Shared PR-description prompt fragment

## Problem

- Patch and plan do not share one PR-description prompt contract today.
- The regression fix needs one lean fragment every mode inherits.

## Decisions

- Add one registry-backed fragment for PR descriptions and have both mode-specific PR-body prompt steps inherit it; do not keep duplicated patch-only and plan-only prompt text.
- Keep the fragment body to the visible shape only: short description, blank line, `Decisions:`, unordered list; do not ask for attribution, progress, checklist mirrors, or spec dumps.
- Keep prompt assembly in the existing prompt registry/layering system; do not introduce ad hoc string concatenation for PR-body prompts.
- Bump only prompt artifact revisions whose rendered output changes; do not churn unrelated prompt ids.

## Tasks

- [ ] Add a shared PR-description fragment artifact to the prompt registry.
- [ ] Wire the patch PR-description prompt step to inherit the new fragment.
- [ ] Wire the plan PR-description prompt step to inherit the new fragment.
- [ ] Regenerate rendered prompt fixtures and revision assertions for the changed prompt ids.
- [ ] Add prompt-level coverage proving both modes render the same shared fragment text.

## Acceptance criteria

- [ ] One prompt-registry fragment exists as the single source for PR-description instructions used by both patch and plan PR-body generation.
- [ ] The fragment asks only for a short description plus a `Decisions:` unordered list.
- [ ] Rendered patch and plan PR-description prompts both include the shared fragment and no longer carry divergent mode-local body-shape wording.
- [ ] Rendered-prompt snapshots and prompt-registry tests cover the new shared fragment and pass.

## Documentation updates

- [ ] Update `v1/docs/prompt-governance.md` for the shipped shared PR-description fragment and its consumers.
- [ ] Update `v2/docs/prompts.md` if it documents the shipped global/behavior fragment inventory or PR-body prompt layering contract.
