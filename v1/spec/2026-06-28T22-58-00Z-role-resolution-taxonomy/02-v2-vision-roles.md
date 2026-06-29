# v2-vision role resolution

## Problem

`v2/docs/v2-vision.md` still describes workflow steps naming model categories
and the "Models separate from agents" constraint cites a category→agent→model
store.

## Decisions

- **Vision cites roles; taxonomy detail lives in `role-resolution.md`** — rules
  out copying the full reference table into the vision doc.
- **Behavior-loop vocabulary unchanged** — rules out renaming
  write/review-and-update/human to match roles.

## Task checklist

- Replace category references in behavior-loop, composability summary, and
  workflow step prose with role-based step binding (`behavior` + `prompt` +
  **role**).
- Update "Models separate from agents" and related constraints to cite
  role→model resolution and cross-link `v2/docs/role-resolution.md`.
- Retire thinking/reviewing/executing as resolution keys throughout the file.

## Acceptance criteria

- [x] `v2/docs/v2-vision.md` behavior-loop, composability summary, and workflow
      step prose describe steps binding `behavior` + `prompt` + **role**, not
      model category.
- [x] "Models separate from agents" (and related constraint prose) cites
      role→model resolution, not category→agent→model.
- [x] The file cross-links `v2/docs/role-resolution.md`.
- [x] No thinking/reviewing/executing category is used as a model-resolution key
      anywhere in `v2-vision.md`. (Manual)

## Documentation updates

- `v2/docs/v2-vision.md` — role-based step binding and model-resolution
  constraint wording.
