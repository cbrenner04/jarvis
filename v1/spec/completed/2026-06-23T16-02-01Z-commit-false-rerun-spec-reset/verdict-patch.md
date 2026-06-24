All five load-bearing findings are confirmed in the code. Issuing the verdict.

---

## Verdict — uphold; the feature does not work on its motivating case

The storage layer (`no-commit-delta.ts`) is sound and well-tested, but the run-loop integration in `iteration.ts` has correctness defects that defeat the spec's primary purpose and corrupt the source spec. The following must be addressed before this spec is complete.

### Required outcomes

1. **Delta capture must survive an interrupt/kill, not just a graceful agent return.**
   Recording currently happens only after the agent returns successfully (the `result.kind === "ok"` path, `iteration.ts:841,862`). Every interrupt path — SIGINT (`:781`), idle/iteration/run timeout (`:732,759,777`) — returns *before* the diff-and-record runs. On the exact groceries case the feature exists for (operator Ctrl-C mid-attempt), the source spec is already mutated on disk but nothing is persisted, so the next run resets nothing. AC #2 ("an interrupted run still leaves the delta recorded") is checked but **not satisfied**. The delta must be captured for an interrupted/killed no-commit run — either by diffing and recording on the interrupt/timeout paths before returning, or by persisting mutations as they occur rather than via a single after-the-fact diff. This is the most important fix; it is the difference between the feature working and not.

2. **A multi-iteration no-commit run must not reset its own in-flight progress.**
   The reset block (`iteration.ts:412-418`) runs on every non-fixup iteration with no first-iteration / once-per-run guard. Because the delta is persisted to disk as the agent ticks AC, iteration 2 calls `loadDelta` and re-reads *this run's own* just-written delta, then `applyReset` reverts the AC the agent legitimately ticked this run. This contradicts the spec's "run-cumulative measured against **run-start** state" decision — "prior delta" must mean a prior *run's* delta. The reset must apply at most once per run, against the state at run start, and never undo progress the current run is making.

3. **Blocker stripping must correctly remove the entire recorded `## Blocker` section.**
   The recorded blocker body is multi-line, but `applyReset` matches it line-by-line (`no-commit-delta.ts:127`, `currentLine.trim() === blockerText || currentLine.includes(blockerText)`). A single file line can never equal or contain a multi-line string, so stripping stops after the first body line and leaves the rest of the blocker text orphaned in the spec — source-file corruption. (The `## Blocker` heading itself *is* removed, so this is residual-text corruption, not an exit-7 short-circuit.) The spec said "do not design new identity machinery"; reuse the existing section-stripping helper (`stripBlockerSection`, already imported and used elsewhere in this file) rather than the hand-rolled matcher. Outcome: a recorded multi-line blocker is removed in full.

4. **Add run-loop integration tests that actually exercise these paths.**
   Current tests unit-test the storage helpers directly; nothing drives `runIteration`, which is why defects 1–3 pass CI. The blocker test uses a single-line blocker, masking the multi-line break. AC #8 requires tests for capture on an *interrupted* no-commit run and for blocker strip on re-run — these must drive the integration and use a multi-line blocker so the real behavior is graded. The interrupted-run AC must be backed by a test that would fail against the current capture gap.

### Should also fix (minor, same code region — fold in)

5. **Honor "record this run's delta on incomplete" when the run reset a prior delta and then exits with no mutations.** `createFreshDelta` updates memory only; if no tick/blocker occurs, the prior on-disk record is never cleared or overwritten, so a stale delta lingers. Behavior is idempotent (no AC still matches) but the lifecycle is not honored. Clear/overwrite the record to reflect this run's actual (possibly empty) delta on an incomplete exit.

6. **Tighten matching to align with the parser.** AC keying uses `line.slice(6)` (untrimmed) against a trimmed AC text key and `startsWith("- [x] ")` (rejects indented checkboxes the parser accepts); the AC-section terminator uses `line.startsWith("##")` (also matches `###`) where the parser ends only on exact level-2 headings. Align these with the existing spec-parser conventions so an indented AC or a `###` subheading inside the AC block does not silently break tracking or reset the wrong line.

### Rationale

Outcomes 1–3 are correctness on the motivating case: the spec's required refinements explicitly call out interrupt-capture, run-cumulative-vs-run-start semantics, and reuse-not-reinvention of identity/stripping machinery. As implemented, the feature captures nothing on Ctrl-C, resets its own progress across iterations, and corrupts the spec when stripping a real (multi-line) blocker — silently failing or doing harm on exactly the babysitting the intent targets. Outcome 4 is the reason all three shipped green and is required by AC #8. Outcomes 5–6 are low-risk robustness fixes in the same code and worth folding into the same change.