## Verdict — `commit-false-rerun-spec-reset`

The spec's direction is sound: scoping to no-commit runs, ordering the reset before the start-of-iteration blocker/exit-7 check, and defaulting to auto-reset (no `--retry` flag) all hold. The reset machinery is not novel — patch mode already snapshots run-start AC state and computes a per-run `newlyChecked` delta keyed by AC text. The spec's weakness is under-specification and under-citation of that reuse, plus several real correctness gaps on the motivating case. Refine as follows.

### Required refinements

1. **Capture must fire on interrupt/kill, not only graceful incomplete exit.** The intent centers on interrupted-then-retry. If the delta is only persisted on a clean exit, an operator Ctrl-C mid-attempt leaves nothing recorded and the reset never fires on exactly the case it exists for. Specify that the attempt delta is persisted incrementally as ticks/blocker mutations occur (or otherwise survives an interrupted run), and add an AC covering capture on an interrupted no-commit run. This is the single most important fix — it determines whether the feature works on its primary use case.

2. **Define "attempt" as run-cumulative, not last-iteration.** A no-commit run loops across fix-ups and blocker-claim rejections. The persisted delta must be the cumulative set of AC newly ticked (and blocker appended) over the whole run measured against run-start state, not just the final iteration's before/after. The current singular "the prior attempt's delta" is ambiguous; pin the run-cumulative semantics.

3. **Specify the subspec scope of the delta key.** "Keyed by resolved spec path" is too loose for index-routed specs — the existing tick machinery keys on the active subspec, and the index checkbox flips separately. State which path the delta is keyed by, that it spans the active subspec(s) actually mutated, and whether a no-commit index-checkbox flip is in or out of scope. If single-subspec is assumed, state it rather than leaving it implicit.

4. **Pin the reset→recapture lifecycle order.** A run that resets a prior delta and then ends incomplete again must clear the old record and persist this run's fresh delta. As written, "clear after reset" plus "clear after completion" could wipe the newly recorded delta. Specify the order: load+reset prior delta → run → on incomplete, record this run's delta → on completion, clear. Add the clean-completion guarantee as an AC: a completed no-commit run leaves no persisted delta and triggers no reset on a later unrelated run (the checklist mentions clearing-on-completion but no AC grades it).

5. **Cite the existing delta/identity machinery instead of describing it as new design.** State that the delta is the run's `newlyChecked` set (existing `diffAcceptanceCriteria` output) captured against run-start state, that AC are keyed by their text per the existing patch-mode convention, and that only that key-set is persisted (not a full pre-attempt snapshot). Make explicit that an AC whose wording the operator edits between runs fails safe — the reset reverts nothing rather than the wrong thing — because of the "only those still ticked / only if still the attempt's" guard. This resolves the "how is a prior-attempt tick distinguished from an operator tick" question by naming the mechanism rather than implying a novel one.

6. **Fix the gate framing.** Use the existing `gitEnabled` flag as the single condition; drop the redundant active-spec-path-equals-source-spec-path phrasing. One gate, named to match the code.

7. **Correct the "committed/operator state" terminology.** No-commit specs in jarvis-owned storage are never git-committed; "committed ticks" misleads. Reword to "pre-attempt / authored" state throughout, AC #4 especially.

8. **State the discarded-blocker behavior explicitly as accepted.** Auto-reset erases the prior `## Blocker` even when it described a still-valid environmental block. This is defensible (the operator chose to re-run) but currently implicit — record it as an accepted edge in one line, alongside the existing operator-re-tick edge.

### Rationale

Refinements 1–4 are correctness on the motivating groceries case: a spec that captures on the wrong event, scopes the delta to the wrong granularity, or races its own lifecycle would silently fail to reset or reset the wrong thing — the exact babysitting the intent targets. Refinements 5–8 are cheap precision/terminology fixes that prevent a reviewer or implementer from reading invented design where reuse is intended, and keep the spec honest about its accepted edges. None of these touch the spec's direction; they make it implementable without the actuator re-deriving load-bearing decisions.