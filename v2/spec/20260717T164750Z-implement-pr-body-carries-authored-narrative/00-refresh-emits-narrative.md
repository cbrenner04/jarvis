# refreshPrBody emits a supplied narrative in the marker block

## Problem

`refreshPrBody` only ever *preserves* a narrative already present in the fetched PR body
(`extractNarrative` → re-wrap). It has no way to *introduce* a narrative, so a caller that
authors one (subspec 01) has nowhere to hand it. Give the refresh layer an input for a
freshly-authored narrative and make the marker block round-trip.

## Decisions

- `refreshPrBody` gains an optional `narrative` input carrying freshly-authored narrative text.
- Precedence: an existing narrative extracted from the fetched body wins over the supplied `narrative` — preserves human edits and prior machine-owned narrative on any re-publish. The supplied `narrative` fills the marker block only when the fetched body has none. Rules out the wrong alternative of the supplied narrative clobbering human edits on every re-publish.
- Marker block is emitted whenever narrative text (preserved or supplied) exists; when neither exists, no marker block is emitted — keeps plan/intent PRs that pass no narrative unchanged, no empty-marker churn.
- Empty/whitespace-only supplied `narrative` is treated as absent.

## Task checklist

- Add optional `narrative` to `RefreshPrBodyInput`.
- In `refreshPrBody`, choose `extractNarrative(currentBody) ?? trimmedSuppliedNarrative` as the block content; emit markers when that is non-empty.
- Extend `pr-body-refresh.test.ts`.

## Acceptance criteria

- [x] A `pr-body-refresh.test.ts` case supplying `narrative` with a marker-less fetched body asserts the written body carries that narrative between `NARRATIVE_START_MARKER`/`NARRATIVE_END_MARKER`, and that `extractNarrative(writtenBody)` returns it; it fails against the pre-fix code.
- [x] The existing preserve test (`pr-body-refresh.test.ts` "composes header + preserved narrative + footer") stays green, and a case supplying a *different* `narrative` alongside an existing marker block confirms the existing narrative is kept (supplied ignored).
- [x] When neither an extracted nor a supplied narrative exists, the written body carries no marker block (existing marker-less behavior unchanged).

## Documentation updates

- `v2/docs/workflow-runner.md` — document the marker contract: `refreshPrBody` preserves an extracted narrative, else emits the supplied one; markers round-trip.
- `v2/docs/v1-behaviors.md` — record that v2 `refreshPrBody` can now introduce a supplied narrative into the marker block (changed publication behavior).
