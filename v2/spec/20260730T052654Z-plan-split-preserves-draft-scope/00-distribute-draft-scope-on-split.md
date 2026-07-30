# Distribute draft scope on plan split

When `normalizePlanDraftSpecDir` splits a multi-boundary drafted subspec, partition drafted decisions,
acceptance criteria, and documentation-update bullets across emitted children instead of re-deriving or
duplicating them.

## Decisions

- Partition `## Decisions` and `## Documentation updates` bullets with the same surface classifier
  used for acceptance criteria — rules out copying the full parent body into every child.
- Decision and documentation bullets that match more than one known surface require assignment or
  hard-error — same rule as acceptance criteria in
  `v2/spec/20260727T203910Z-plan-emits-one-subspec-per-module-boundary/00-module-boundary-classifier.md`
  — rules out silently omitting multi-match bullets at split time.
- Unclassified decision and documentation bullets land on the first emitted boundary child (same floor
  as zero-surface AC lines) — rules out hard-erroring or dropping unclassified prose.
- Lines removed by split-residue stripping are not part of the verbatim preservation set — rules out
  emitting forbidden provenance or planning-label bullets the split step already drops.
- Parent `## Problem`, `## Evidence`, and task-checklist prose are not verbatim-copied into every
  emitted subspec; boundary-local authoring there is allowed — rules out applying the exactly-once
  rule to those sections.
- Committed `manifest.json` per-child expectations are ground truth for surviving `## Decisions`,
  `## Acceptance criteria`, and `## Documentation updates` bullets — rules out runtime union checks
  or re-invoking the classifier as the test oracle; union and exactly-once are structural
  consequences of manifest equality, not a weaker substitute.

## Tasks

- Extend `shared/fixtures/module-boundary-surfaces/` k2/k3 drafts and `manifest.json` with per-child
  expected surviving `## Decisions`, `## Acceptance criteria`, and `## Documentation updates`
  bullets (include classifiable bullets per boundary plus at least one unclassified bullet that must
  land on the first child).
- Teach `normalizePlanDraftSpecDir` to partition those sections per boundary instead of duplicating the
  parent body.
- Add manifest-equality preservation assertions to `shared/module-boundary-surfaces.test.ts`.

## Acceptance criteria

- [ ] `shared/module-boundary-surfaces.test.ts` runs `normalizePlanDraftSpecDir` on the k2 and k3
      fixtures and asserts each emitted child's surviving `## Decisions` and `## Acceptance
      criteria` bullets match the committed `manifest.json` per-child expectations literally; the
      manifest union equals the surviving parent bullets exactly once; it fails when a bullet is
      dropped, duplicated, or placed on the wrong boundary, and fails against the pre-change
      emit-as-drafted/duplicated-body path.
- [ ] The same test asserts each emitted child's surviving `## Documentation updates` bullets match
      the committed manifest per-child expectations literally; it fails against the pre-change path
      when documentation bullets are duplicated across children.
- [ ] Inverting the partition/preservation guard inside `normalizePlanDraftSpecDir` turns the k2
      fixture RED for decisions, acceptance criteria, and documentation-updates preservation (both
      preservation ACs above).

## Documentation updates

- None — deferred to first consumer per intent; pin when the preservation fixture names operator-facing
  wording.
