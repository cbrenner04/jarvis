# Surface unchecked human-only criteria on the PR

## Problem

Once a run completes with human-only criteria left unchecked (subspec 00), the
reviewer needs to know what to verify by hand. The current PR body
(`buildPrBody`) lists nothing about them.

## Decisions

- Append a human-verify checklist section to the PR body listing each unchecked human-only criterion across the index's linked subspecs, identifying its source subspec. Rules out a flat unattributed list the reviewer can't trace.
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
