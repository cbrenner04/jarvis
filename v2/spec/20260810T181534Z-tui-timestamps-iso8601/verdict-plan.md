## Verdict — refine

Six upheld items. All are additive clarifications to one subspec; no split is required (`decidedAt` is one entry in the same seam, verified by the same suite — splitting it would produce a subspec of one array element).

**1. Malformed timestamp input has no decision (correctness regression).**
Snapshot data reaches the TUI through an unvalidated cast (`v2/src/tui/tui-daemon-client.ts:73-78` checks only that `pipelines` is an array), so a non-finite or out-of-range epoch value can arrive. Today raw-epoch rendering prints whatever it gets and cannot throw; `new Date(NaN).toISOString()` throws `RangeError` and would take down the right-pane paint. This change turns a cosmetic corruption into a crash. The ledger enumerates `0`, `null`, and `undefined` and stops there. Add a decision fixing the behavior for non-finite / out-of-range input (a printable fallback, never a throw) and an acceptance criterion pinning it in the formatter's co-located test.

**2. Both `@mutate` directives are anchored to source that does not exist yet.**
`"formatAbsoluteTimestamp(value)"` presumes a parameter identifier the seam's `.map` may not use and presumes exactly one occurrence; `"epochMs === null || epochMs === undefined"` dies if the implementation writes `epochMs == null`. Spec guidance prefers a unique definition line over a bare call expression that may change arity or recur. Both fail closed at completion (`unparseable directive`), so a wrong anchor strands the implement run. Re-anchor both to text the spec itself fixes — e.g. the formatter's exported signature line and a seam line the subspec mandates verbatim.

**3. Directive→pinning-test mapping is unstated.**
Two directives and two pin titles are listed with only "place inside the named pinning test bodies." Linkage is by enclosing `test()` title; a directive dropped in the wrong file is unselected and dead. State explicitly which directive belongs in which named test in which file. The absent-value guard directive must land in the monitor-lines pin (`absent absolute timestamps paint no detail row`) for the mutation to turn that suite red.

**4. Documentation coverage is incomplete in two places.**
`v2/docs/operator-runbook.md` repeats the raw-timestamp claim in a second location (the table row near `:280`, "Pipeline detail carries forensic `wallClock` plus raw creation/finish timestamps"), which the current doc bullet does not name — leaving it stale. Separately, the new stage `decidedAt` row sits next to an existing `decided=` gate rollup that reads `stage.endedAt` (`v2/src/tui/tui-monitor-lines.ts:723`), so an operator will see two decision-flavored values sourced from different fields; the doc updates must disambiguate them in one sentence.

**5. A required fixture does not exist.**
No `tui-monitor-lines.test.ts` fixture paints a stage with a non-null `decidedAt` in detail (`:116` sets it to `null`; non-null cases live in `tui-attention-rows.test.ts`). The task checklist must say a new fixture is needed rather than imply an existing pin can be updated.

**6. Two scope/collateral notes.**
(a) The `createdAt: 0` fixture at `tui-monitor-lines.test.ts:1717` is a witness for the existing falsy-but-present detail guard; after this change that value is a truthy ISO string. Coverage survives on `isLive: false` / `prNumber: 0` / `iterationsConsumed: 0`, but the checklist's "update fixtures/pins that assert `createdAt: 0` to the ISO form" reads as find-and-replace — add a note that the falsy-present guard's remaining witnesses must be preserved deliberately. (b) The intent says "every scalar absolute wall-clock detail field," while the seam covers eight flat labels; unrecognized artifact shapes fall through to `prettyJsonRows` (`:700-701`) and would keep raw epochs in nested JSON. Add one ledger line ruling nested artifact JSON out of scope.

**Not upheld — leave as drafted:** whole-second truncation (bound by the intent's no-fractional-seconds decision; the detail pane renders one stage at a time so no ordering collision is observable), the `tui-entry.test.tsx` / `tui-ink-monitor.test.tsx` surface (fixtures only, zero assertions on rendered timestamp text), and splitting `decidedAt` into its own subspec.

**Minor:** AC 1's parenthetical justifies "fails against the pre-fix tree" with "the module does not exist," which proves nothing behavioral. The failing-test requirement is satisfied by AC 2; drop or correct the parenthetical rather than resting the claim on module absence.