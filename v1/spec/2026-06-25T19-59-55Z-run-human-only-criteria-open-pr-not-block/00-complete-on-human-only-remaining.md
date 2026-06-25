# Complete the draft-PR path when only human-only criteria remain

## Problem

A subspec is treated complete only when **every** acceptance criterion is checked
(`allChecked` in `iteration.ts`). When the agent ticks all automated criteria but
the remaining unchecked ones are human-only (`(Manual)`, "visual inspection only",
"no automated guard"), the subspec never auto-completes, the index checkbox never
flips, the run keeps iterating, and it ends at exit 7 with no PR.

## Decisions

- A human-only acceptance criterion is one whose text contains, case-insensitively, any of the seed markers `(Manual)`, `visual inspection only`, or `no automated guard`. Rules out inventing broader marker syntax (out of scope per intent).
- Classification is a `humanOnly` field on the parsed `AcceptanceCriterion`, computed once in `shared/spec-parser.ts`. Rules out re-detecting markers ad hoc at each consumer.
- Subspec completion = every non-human-only criterion is checked; unchecked human-only criteria do not block completion. Rules out today's all-checked requirement, which causes the block.
- The existing non-empty guard (`afterCriteria.length > 0`) is preserved, so a criterion-less subspec is still never auto-completed.
- Unchecked human-only criteria are left unchecked in the committed subspec file; the harness does not auto-tick them. Rules out silently marking unverified work done.

## Task checklist

- [ ] Add `humanOnly` to `AcceptanceCriterion` in `shared/spec-parser.ts`, set from the three seed markers (case-insensitive).
- [ ] Replace the `allChecked` completion lever in `v1/src/modes/patch/iteration.ts` (both the pre-agent uncommitted-ticks path and the post-agent decision) with "every non-human-only criterion checked".
- [ ] Confirm the completed subspec commit (`commitSubspec` → index checkbox flip) and the downstream completion pipeline (ready gate → draft PR → ready) run unchanged once completion is reached.
- [ ] Update docs.

## Acceptance criteria

- [ ] A patch run whose active subspec's only remaining unchecked acceptance criteria are human-only finishes the normal completion path (index checkbox flips, completion ready gate runs, draft PR is opened/marked ready) instead of iterating further or exiting blocked.
- [ ] A subspec with at least one unchecked automated (non-human-only) criterion is still treated as incomplete and keeps iterating; it does not complete early.
- [ ] `parseSpec` classifies an acceptance criterion as human-only when its text contains `(Manual)`, `visual inspection only`, or `no automated guard` (case-insensitive), and as automated otherwise.
- [ ] After such a run completes, the unchecked human-only criteria remain unchecked in the committed subspec file (they are not auto-ticked).

## Documentation updates

- `v1/docs/run-loop.md` — completion semantics: a subspec completes when every non-human-only criterion is checked; human-only criteria stay unchecked for human verification.
- `v1/docs/spec-guidance.md` — author convention: the three human-only markers and that such criteria do not block completion.
- `v2/docs/v1-behaviors.md` — record the changed completion rule (per `specs-update-v1-behaviors`).
