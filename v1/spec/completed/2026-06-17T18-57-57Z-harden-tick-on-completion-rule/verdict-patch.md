I'll verify the key claim against the actual file on disk before issuing my verdict.The file confirms the structural finding. Now I have full grounding to issue the verdict.

# Verdict — Refinement Required

The spec's behavioral intent is fully achieved: the mandatory-tick semantics, the already-done-on-entry carve-out, the unchanged satisfied bar, the untouched `run.ts`/no-progress path, and the behavior-doc add are all present and correct, and every acceptance criterion is genuinely satisfied. One structural requirement the spec explicitly encoded was violated, and it must be corrected before this ships.

## Required outcome

1. **Consolidate the two overlapping ticking directives in `prompts/patch/rules.md` into one, folded into the existing ticking line's region.** Task #1 of the subspec explicitly directs folding the mandatory-tick requirement into the existing ticking line (the "tick `- [ ]` … as you actually satisfy them. Do not tick speculatively. Do not tick anything else." line) and the former "Stop when you have made meaningful progress…" line, *replacing/reworking that region*, and explicitly forbids appending a new bullet that overlaps the existing ticking line. What landed instead left the original ticking line fully intact and added a *separate*, *non-contiguous* second ticking bullet — split from the first by the unrelated index-checkbox sentence. The result is two overlapping tick directives where the spec required one consolidated statement.

   **What must be true:** A single, contiguous ticking directive in the `## Iteration` block that states (a) ticking confirmed-satisfied acceptance criteria is a mandatory final step, and (b) acceptance criteria left `- [ ]` on entry whose work is already complete must be re-verified and ticked, never reported "already done" and left unticked — while preserving the genuinely-satisfied restriction and the no-speculative-tick rule. No second, overlapping ticking bullet remains. The index-checkbox sentence (Jarvis flips the `index.md` checkbox itself) stays intact and unchanged.

   **Rationale:** The repo's terseness mandate is the reason the spec deliberately required consolidation; two redundant, fragmented ticking bullets are a real quality miss the spec foreclosed by name. No acceptance criterion guards structure, so this slipped through despite a green suite — but it is a direct deviation from an explicit task instruction, not a stylistic preference.

## Consequential, not separately actionable

- The two `@r3` rendered fixtures (`patch.prompt.body@r3.shared.txt` and `patch.prompt.body@r3.wrapper.codex.exec.stdin+marker.txt`) must continue to mirror the rules body verbatim, so they must be regenerated to match the consolidated prose. Keep their filenames and the snapshot test's `patch.prompt.body` revision assertion (`"3"`) unchanged — this is a body-text change only, not a rendered-artifact revision change.

## Not required

- No `revision` change in `prompts/patch/rules.md` (stays `2`); no behavior change; no acceptance-criteria, `run.ts`, or no-progress-message change.
- The orphaned `@r1`/`@r2` fixtures are out of scope and correctly left untouched — they snapshot prior rendered-artifact revisions referenced by no live test.
- The `v2/docs/v1-behaviors.md` entry is a correct add citing `prompts/patch/rules.md`; its length is acceptable since each clause carries a distinct required fact. Optional light tightening only if already editing nearby — no churn warranted otherwise.