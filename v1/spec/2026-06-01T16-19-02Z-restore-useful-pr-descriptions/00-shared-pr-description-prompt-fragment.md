# 00 - Shared PR-description prompt fragment

## Problem

- Patch and plan do not share one PR-description prompt contract.

## Decisions

- Add one prompt-registry fragment for PR descriptions and have patch and plan inherit it; do not keep mode-local body-shape text.
- Keep the fragment to the visible body shape only: short description, blank line, `Decisions:`, unordered list; do not ask for attribution or progress text.

## Tasks

- [ ] Add a shared PR-description fragment artifact and wire patch and plan PR-description steps to inherit it.
- [ ] Regenerate rendered prompt fixtures and revision assertions for the changed prompt ids.
- [ ] Add prompt-level coverage proving both modes render the same shared fragment text.

## Acceptance criteria

- [ ] One prompt-registry fragment exists as the single source for PR-description instructions used by both patch and plan PR-body generation.
- [ ] The fragment asks only for a short description plus a `Decisions:` unordered list.
- [ ] Rendered patch and plan PR-description prompts include the same shared fragment text rather than divergent mode-local body-shape wording.
- [ ] Rendered-prompt snapshots and prompt-registry tests cover the shared fragment.

## Documentation updates

- [ ] Update `v1/docs/prompt-governance.md` for the shipped shared PR-description fragment and its consumers.
- [ ] Update `v2/docs/prompts.md` if it documents the shipped fragment inventory or PR-body prompt layering contract.
