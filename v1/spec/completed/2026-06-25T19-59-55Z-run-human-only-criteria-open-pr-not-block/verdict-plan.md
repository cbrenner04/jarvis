## Verdict

The spec's structure, decision terseness, docs coverage, and v1-behaviors updates are sound. Two correctness gaps and several clarity gaps must be refined before this lands.

### Required refinements

**R1 — Add a harness-side guard so a blocker no longer suppresses the PR (must fix).**
The intent's whole purpose is that a human-only-only run produces a reviewable draft PR instead of exit 7. But the fix as drafted is essentially prompt-only (subspec 01): the post-agent blocker handling returns exit 7 *before* the completion path runs, and the start-of-iteration blocker check fires on the next loop. If the agent appends a `## Blocker` for a human-only criterion — exactly what produced the observed `4/7` block — the completion-lever change in subspec 00 never executes. A probabilistic prompt cannot be the sole defense against the precise regression this spec exists to kill. The spec must add a harness guard: when a blocker is present but every non-human-only criterion is checked, the blocker is not honored and the run takes the completion path. This must cover both the post-agent and start-of-iteration blocker checks. (There is existing precedent for stripping-and-continuing on a base-ref-green blocker claim, so this fits the architecture.)

**R2 — Anchor the human-only marker matching to prevent false positives (must fix).**
Unanchored case-insensitive `contains` on free-prose markers (`visual inspection only`, `no automated guard`) will misclassify genuinely automated criteria — e.g. "add an automated guard where there is **no automated guard** today" or "this is **not** visual-inspection-only — a snapshot covers it" — as human-only. A misclassified automated criterion gets left unchecked, and completion then fires on unverified automated work, producing a false PR. That failure mode is strictly worse than the false block being fixed. The spec must define matching precise enough to avoid this (e.g. an anchored trailing marker) and add a negative-case acceptance criterion pinning that a criterion merely *mentioning* a marker phrase in prose is classified automated, not human-only.

**R3 — Decide all-human-only (vacuous) completion.**
The predicate "every non-human-only criterion is checked" is vacuously true when *every* criterion is human-only, guarded only by the non-empty check. A pure-visual subspec would complete on the first post-agent iteration regardless of whether any work was done, bypassing the "edited but ticked nothing" safeguard. The spec must decide explicitly what an all-human-only subspec requires before completing (e.g. an edit/iteration signal) and carry an AC for it.

**R4 — Pin the count/summary semantics.**
The bug surfaced operator-facing as `WIP: … (4/7 criteria)`. The spec must state whether human-only criteria count toward the criterion total and what a completed human-only-only run reports in its summary/commit (e.g. `7/7` vs `4/7`). This is operator-facing and currently undefined.

**R5 — Add the end-to-end behavioral AC.**
No AC currently asserts the actual end state: a run whose only unmet criteria are human-only produces a draft PR rather than exit 7, *even when the agent attempts to block*. Subspec 00's first AC presupposes no blocker was appended. The AC added with R1's guard must close this.

### Clarifications (one line each)

- **C1** — State that subspec 02's PR human-verify checklist *is* the intent's "reviewer-facing note," foreclosing an in-file-annotation reading.
- **C2** — Acknowledge in subspec 02 that the PR body already dumps subspec text verbatim, and state why a dedicated aggregated checklist (actionable, attributed, single location) is still warranted.
- **C3** — Subspec 00 names "both" completion levers as if exhaustive; make the completion-site scope explicit and state that the full-completion fixup path is out of scope.
- **C4** — Declare the ordering dependency: subspec 02 (and the PR-body work) consumes subspec 00's `humanOnly` classification and cannot land first.

### Rejected

- The concern that `humanOnly` won't thread through the snapshot to the completion and PR-body consumers is unfounded — the snapshot returns the parsed criteria whole, so a field added in the parser propagates automatically. No structural change or extra task is required (a confirmatory note is harmless but optional).