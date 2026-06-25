# Complete the draft-PR path when only human-only criteria remain

## Problem

A subspec is treated complete only when **every** acceptance criterion is checked
(`allChecked` in `iteration.ts`). When the agent ticks all automated criteria but
the remaining unchecked ones are human-only (`(Manual)`, "visual inspection only",
"no automated guard"), the subspec never auto-completes, the index checkbox never
flips, the run keeps iterating, and it ends at exit 7 with no PR. Worse, the
observed failure was an appended `## Blocker` for the human-only criterion, which
exits 7 *before* any completion logic runs — so a completion-lever change alone
does not kill the regression.

## Decisions

- A human-only acceptance criterion is one whose text **ends with** (after trimming trailing whitespace and a single trailing period) one of the seed markers `(Manual)`, `visual inspection only`, or `no automated guard`, matched case-insensitively. Anchoring to a trailing marker rules out misclassifying automated criteria that merely mention a phrase in prose (e.g. "add a guard where there is no automated guard today", "not visual-inspection-only — a snapshot covers it"), which would leave automated work unchecked yet still complete — strictly worse than the false block. Also rules out inventing broader marker syntax (out of scope per intent).
- Classification is a `humanOnly` field on the parsed `AcceptanceCriterion`, computed once in `shared/spec-parser.ts`. Rules out re-detecting markers ad hoc at each consumer.
- Subspec completion = every non-human-only criterion is checked; unchecked human-only criteria do not block completion. Rules out today's all-checked requirement, which causes the block.
- Harness blocker guard: at both blocker checks (start-of-iteration, line ~508, and post-agent, line ~942), if a `## Blocker` is present but every non-human-only criterion is checked, the blocker is **not** honored — the harness strips the blocker section and takes the completion path instead of exiting 7. Reuses the existing strip-and-continue mechanism already used for base-ref-green blocker-claim rejection (line ~1007). Rules out a prompt-only fix (subspec 01), which cannot reliably prevent the precise blocker-induced regression this spec exists to kill.
- All-human-only guard: a subspec whose criteria are **all** human-only completes only once the agent has committed at least one code change for it this run; with no change it does not vacuously complete and keeps iterating. The non-human-only predicate is vacuously true here, so without this an all-human-only subspec would complete on the first post-agent iteration regardless of work done. Rules out bypassing the "edited but ticked nothing" safeguard.
- The existing non-empty guard (`afterCriteria.length > 0`) is preserved, so a criterion-less subspec is still never auto-completed.
- Unchecked human-only criteria are left unchecked in the committed subspec file; the harness does not auto-tick them. Rules out silently marking unverified work done.
- Count semantics: human-only criteria count toward the criterion total (denominator unchanged, preserving the operator's `N/total` framing). A completed human-only-only run's summary/commit reports the automated criteria as satisfied and labels the unchecked human-only remainder as human-verify (e.g. `4/7 (3 human-verify)`), not a false `7/7`. Rules out reporting unverified human-only work as done.

## Scope

- The two completion levers changed are the start-of-iteration uncommitted-ticks path (`iteration.ts` ~534) and the post-agent decision (~924). The full-spec fixup-completion path (`tryFinishSpecIfDone`) consumes their result and is **out of scope** — it runs unchanged once a subspec completes.

## Task checklist

- [ ] Add `humanOnly` to `AcceptanceCriterion` in `shared/spec-parser.ts`, set from the three seed markers (trailing-anchored, case-insensitive).
- [ ] Replace the `allChecked` completion lever in `v1/src/modes/patch/iteration.ts` (both the pre-agent uncommitted-ticks path and the post-agent decision) with "every non-human-only criterion checked", plus the all-human-only edit-signal guard.
- [ ] Add the harness blocker guard at both blocker checks: strip and take the completion path when every non-human-only criterion is checked.
- [ ] Pin the count/summary format so a completed human-only-only run reports `<automated-checked>/<total> (<n> human-verify)` rather than blocking or reporting `total/total`.
- [ ] Confirm the completed subspec commit (`commitSubspec` → index checkbox flip) and the downstream completion pipeline (ready gate → draft PR → ready) run unchanged once completion is reached.
- [ ] Update docs.

## Acceptance criteria

- [x] A patch run whose active subspec's only remaining unchecked acceptance criteria are human-only finishes the normal completion path (index checkbox flips, completion ready gate runs, draft PR is opened/marked ready) instead of iterating further or exiting blocked — **even when the agent appended a `## Blocker` for a human-only criterion** (the blocker is stripped, not honored).
- [x] A subspec with at least one unchecked automated (non-human-only) criterion is still treated as incomplete and keeps iterating; an appended `## Blocker` for it still exits 7. It does not complete early.
- [x] `parseSpec` classifies an acceptance criterion as human-only when its text ends with `(Manual)`, `visual inspection only`, or `no automated guard` (case-insensitive, trailing whitespace/period ignored), and as automated otherwise.
- [x] A criterion that only *mentions* a marker phrase mid-prose (e.g. "add an automated guard where there is no automated guard today") is classified automated, not human-only.
- [x] A subspec whose criteria are all human-only does not complete on a no-op iteration with no committed code change; it completes only after the agent commits at least one code change.
- [x] A completed human-only-only run's summary/commit reports the automated criteria as satisfied and the unchecked human-only criteria as human-verify (e.g. `4/7 (3 human-verify)`), not `7/7`.
- [x] After such a run completes, the unchecked human-only criteria remain unchecked in the committed subspec file (they are not auto-ticked).

## Documentation updates

- `v1/docs/run-loop.md` — completion semantics: a subspec completes when every non-human-only criterion is checked; human-only criteria stay unchecked for human verification; a blocker is not honored when only human-only criteria remain; count/summary format.
- `v1/docs/spec-guidance.md` — author convention: the three human-only markers (trailing-anchored) and that such criteria do not block completion.
- `v2/docs/v1-behaviors.md` — record the changed completion rule and the blocker-guard exception (per `specs-update-v1-behaviors`).
