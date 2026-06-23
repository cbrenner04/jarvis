# Verdict — First Review Pass

The intent and additive approach are sound. Three findings are load-bearing and must be refined before implementation; three more warrant a one-line decision each. The rest are notes or over-reach.

## Required refinements

**R1 — The "tests stay green" claim is false against the existing line-count test.**
A pre-existing no-arg listing test asserts the *total* count of non-empty output lines (not just table rows). Any appended verdict line breaks it. Subspec 00's decision ("keeps current summary tests green and the change additive") and its AC ("pre-existing no-arg listing tests stay green") are literally wrong as written. The spec must (a) authorize editing that test to scope its assertion to the table rows, and (b) restate the additivity guarantee as a contract on the *table content* — "the existing NAME/DIRTY/PR/SPEC rows still print unchanged, with the verdict appended below" — rather than "all existing tests stay green." Per spec guidance, a refactor/preservation AC must cite the real contract it preserves, not assert a falsehood a test already disproves.

**R2 — No testability seam for PR/gate state; this is unscoped real work.**
Every new AC in both subspecs turns on PR state and gate state that the test harness cannot currently produce (gh is invoked via raw `execSync` in the PR-state helpers, errors are swallowed, and tests never drive a real PR state). The task checklists assume a stubbing seam that does not exist. Subspec 00 must make an explicit decision on how gh output is made injectable/stubbable for tests (an injected runner vs. a PATH shim), so the implementer does not invent an unbounded refactor. Name it where the helpers live (00).

**R3 — Draft-vs-ready is misdescribed against GitHub's data model.**
Draftness is GitHub's separate `isDraft` boolean, not a value of the `state` field (which is only OPEN/CLOSED/MERGED). The decision's "DRAFT vs OPEN from `state`/`isDraft`" and its cost rationale ("rules out a second gh call when triage already fetches state") are misleading: the table path fetches `--json state` only — `isDraft` is *not* fetched today. Distinguishing draft requires adding `isDraft` to the existing JSON query. Correct the decision to say so; it is a changed query, not a no-op on already-fetched fields.

## One-line decisions needed

**R4 — Classify a PR-state query failure.**
The PR-state helper returns the same "none" result for both "no PR exists" and "gh errored." Subspec 00 is silent on this while 01 carefully models a failed *gate* query as "unavailable." Subspec 00 must state how a PR-state query failure classifies a worktree. (It lands in the safe direction — a false-outstanding never hides a failed merge, matching the intent's guard — so a one-line decision suffices; no redesign.)

**R5 — Plan worktrees in the sweep.**
The intent sweeps "every current Jarvis-managed worktree," which includes plan worktrees (`.worktree/plan-*`). These have no implementation PR and will always classify as outstanding. This may be correct (an uncleaned plan tree is genuine unfinished business) but it is currently silent. Subspec 00 must state, in one line, whether plan worktrees are in-scope-as-outstanding or labeled distinctly — not leave it implicit.

**R6 — Tighten the gate-state field example in 01.**
The two named example fields are not interchangeable: one is a single merge-state enum reflecting merge-blocking; the other is an array of raw check rows. Surfacing the latter "verbatim" is exactly the raw-rollup path the same decision rules out. Refine 01 to name the merge-state enum as the merge-blocking field surfaced verbatim, and relegate the check-rollup field to context, so the example does not contradict the decision. The "implementer picks the field" deferral is otherwise fine.

## Notes only (no blocking change)

- **Upstream-gone-after-merge:** post-merge branch deletion makes the unpushed check return zero, so "no unpushed commits" is also satisfied by a deleted upstream. This lands safe (deleted upstream = merged-and-cleaned = landed), but the AC says "fully pushed" and that exact condition isn't literally verified. Worth a doc note, not a redesign.
- **01 depends on 00:** acceptable sequential layering (01 enriches the rendering 00 creates), not the unrelated coupling the atomicity guidance warns against. Note the dependency; do not restructure.

## Rejected

- **CLOSED-unmerged presentation:** an abandoned CLOSED PR is already outstanding by the not-MERGED rule and is visibly distinguishable because the verdict reports per-entry PR state. A separate CLOSED presentation is gold-plating. No change.