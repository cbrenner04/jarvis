# Surface unchecked human-only criteria on the PR

## Problem

Once a run completes with human-only criteria left unchecked (subspec 00), the
reviewer needs to know what to verify by hand. This checklist section **is** the
intent's "reviewer-facing note" for human-only criteria — there is no separate
in-file annotation. The current PR body (`buildPrBody`) lists nothing about them.

## Decisions

- The PR human-verify checklist is the reviewer-facing note named in the intent; it is not an annotation written into the subspec file. Rules out an in-file-comment reading of the intent.
- Append a human-verify checklist section to the PR body listing each unchecked human-only criterion across the index's linked subspecs, identifying its source subspec. The PR body already dumps each subspec's text verbatim, but a dedicated aggregated section is still warranted: it is actionable (only the unmet manual items), attributed (names the source subspec), and in one location instead of scattered across verbatim dumps. Rules out a flat unattributed list the reviewer can't trace.
- Render the section only when at least one unchecked human-only criterion exists. Rules out an empty header on runs with no manual criteria.
- Reuse the `humanOnly` classification from subspec 00. Rules out a second marker definition.

## Task checklist

- [ ] In `v1/src/modes/patch/pr.ts` `buildPrBody`, walk linked subspecs, collect unchecked human-only criteria, and append the checklist section when non-empty.
- [ ] Update docs.

## Acceptance criteria

- [ ] When a completed run's linked subspecs contain unchecked human-only criteria, the draft PR body includes a human-verify checklist section listing each unchecked human-only criterion with its source subspec.
- [ ] When no unchecked human-only criteria exist, the PR body omits the section entirely (no empty header).

## Documentation updates

- `v1/docs/run-loop.md` — note the PR body's human-verify checklist for unchecked human-only criteria.
- `v2/docs/v1-behaviors.md` — record the PR-body addition.
