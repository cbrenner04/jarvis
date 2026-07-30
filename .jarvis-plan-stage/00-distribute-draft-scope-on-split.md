# Distribute draft scope on plan split

When `normalizePlanDraftSpecDir` splits a multi-boundary drafted subspec, partition drafted decisions,
acceptance criteria, and documentation-update bullets across emitted children instead of re-deriving or
duplicating them.

## Decisions

- Partition `## Decisions` and `## Documentation updates` bullets with the same surface classifier
  used for acceptance criteria — rules out copying the full parent body into every child.
- Unclassified decision and documentation bullets land on the first emitted boundary child (same floor
  as zero-surface AC lines) — rules out hard-erroring or dropping unclassified prose.
- Lines removed by split-residue stripping are not part of the verbatim preservation set — rules out
  emitting forbidden provenance or planning-label bullets the split step already drops.
- Parent `## Problem` and task-checklist prose are not verbatim-copied into every emitted subspec;
  boundary-local authoring there is allowed — rules out applying the exactly-once rule to those
  sections.
- Preservation oracle is committed fixture manifest equality on surviving decision bullets, AC checkbox
  lines, and documentation bullets — rules out re-invoking the classifier as the test oracle.

## Tasks

- Extend `shared/fixtures/module-boundary-surfaces/` k2/k3 drafts and `manifest.json` with per-child
  expected `## Decisions`, `## Acceptance criteria`, and `## Documentation updates` bullets (include
  classifiable bullets per boundary plus at least one unclassified bullet that must land on the first
  child).
- Teach `normalizePlanDraftSpecDir` to partition those sections per boundary instead of duplicating the
  parent body.
- Add union-equality preservation assertions to `shared/module-boundary-surfaces.test.ts`.

## Acceptance criteria

- [ ] `shared/module-boundary-surfaces.test.ts` runs `normalizePlanDraftSpecDir` on the k2 and k3
      fixtures and asserts every surviving parent `## Decisions` bullet and `## Acceptance criteria`
      checkbox line appears in exactly one emitted child and the union matches the parent; it fails
      when a bullet is dropped or duplicated across children.
- [ ] The same test asserts every surviving parent `## Documentation updates` bullet appears in
      exactly one emitted child.
- [ ] Inverting the verbatim-preservation guard inside `normalizePlanDraftSpecDir` turns the k2
      fixture case RED.

## Documentation updates

- None — deferred to first consumer per intent; pin when the preservation fixture names operator-facing
  wording.
