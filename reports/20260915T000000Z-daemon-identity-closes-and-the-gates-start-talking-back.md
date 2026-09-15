# 2026-09-14 — daemon identity closes; the draft gates start refusing good work

Operator session, agent order `claude` only. Cost: operator `/cost` **$131.66** (opus-5 $108.39, sonnet-5 $23.26), API 2h37m, wall 22h55m; agent telemetry **$171.57** (sonnet-5 $136.77, opus-5 $34.80; 144 invocations). Total **$303.23**. Ended on Claude quota exhaustion.

## Landed

**Daemon-identity chain — complete.** No daemon ready-intents remain.

- [#3891](https://github.com/cbrenner04/jarvis/pull/3891) unified pipeline namespace on the stable daemon (hand-finished after `quota_exhausted` mid-chain)
- [#3893](https://github.com/cbrenner04/jarvis/pull/3893) + [#3895](https://github.com/cbrenner04/jarvis/pull/3895) protect draining run ownership, recover route loss (00 hand-finished after `iteration_timeout`; 01/02 unattended)
- [#3894](https://github.com/cbrenner04/jarvis/pull/3894) route pipeline verbs to the draining owner (hand-finished: out-of-diff repair fence)
- [#3897](https://github.com/cbrenner04/jarvis/pull/3897) remove client-side daemon socket discovery (hand-finished: repair touched 36 unrelated files; 1 needed)
- [#3903](https://github.com/cbrenner04/jarvis/pull/3903) retire digest-keyed daemon artifacts (unattended; review caught a live-socket reap on dead-PID residue, fixed pre-merge)
- Dropped `route-draining-run-logs-to-owner`: premise false — every generation shares `state/logs.jsonl`; impl #3887 closed, spec removed [#3888](https://github.com/cbrenner04/jarvis/pull/3888).

**Direct fixes (defects found live):**

- [#3886](https://github.com/cbrenner04/jarvis/pull/3886) notification gaps + invocation roll-up (operator hand-land, reviewed here)
- [#3902](https://github.com/cbrenner04/jarvis/pull/3902) prefix resolution refused every healthy listing as `degraded` (regression from #3891)
- [#3907](https://github.com/cbrenner04/jarvis/pull/3907) resumed run's terminal settlement produced no incident
- [#3920](https://github.com/cbrenner04/jarvis/pull/3920) decision verbs refused an `interrupted` pipeline with a dead owner (regression from #3894)

**TUI follows the daemon's revision:** [#3904](https://github.com/cbrenner04/jarvis/pull/3904) monitor (hand-finished), [#3912](https://github.com/cbrenner04/jarvis/pull/3912) `tui log` (unattended).

**Observability / spec home:** [#3918](https://github.com/cbrenner04/jarvis/pull/3918) operator-home sinks honor `JARVIS_HOME` (real-home guard made CI-only pre-merge — it would false-red every local gate beside the live daemon); [#3917](https://github.com/cbrenner04/jarvis/pull/3917) `specs` config key, default external (hand-finished: plan split 00/01 unlandable in order). `~/.jarvis/config.json` migrated: `modes.plan.commit` and all `plan.commit` removed; `specs: "repo"` for jarvis/chess-mvp-yolo/chess-mvp-yolo-2/sudoku, `"external"` for the six groceries/homestead projects; verified live through the merged resolver.

Spec/plan PRs: #3889, #3890, #3892, #3896, #3898, #3910, #3911, #3913, #3915, #3921. Seeds: #3899, #3905, #3906, #3908, #3914, #3919.

## Carried over

- [#3916](https://github.com/cbrenner04/jarvis/pull/3916) specs-home path builder — reviewed, green, **conflicts with #3918**; rebase then merge. Merged without shrink/review via the link-row resume bug (independently diff-reviewed).
- Observability pipeline `25784a7e`: telemetry implement failed `quota_exhausted` (resume/re-dispatch), then approve `cleanup-reaps-orphan-session-logs`.
- Spec-home: plan `single-spec-home-predicate` after #3916 lands, then implement.

## Priority for next session (P0)

1. [[resuming-a-failed-link-row-runs-the-whole-workflow]] — the documented `gate_invocation_refused` recovery (`run resume`) publishes with no shrink or review. Hit #3916; same shape in #3787, #3588.
2. [[artifact-count-exempts-references-and-rules-out-clauses]] — refused 4 sound drafts across 2 plan lanes (rules-out clauses, test+module ACs); `recover` fixes one bullet per round-trip.
3. [[intent-landing-accepts-no-prerequisites]] — `Prerequisites: none` failed a whole pipeline.
4. [[pipeline-lane-ready-pr-notifies]] — a lane's ready PR raises no incident.

Also seeded: [[pipeline-resume-resumes-a-resumable-implement-row]], [[non-terminating-mutation-settlement-names-its-site]], [[completed-write-step-rows-stamp-finished-at]], [[publication-failures-settle-failed]], [[tui-follows-daemon-source-revision]] (landed), `resume-surfaces-admission-gate-refusal` (pipeline pre-dispatch refusals). Evidence added to `implement-resumes-stalled-unmerged-subspec-chain` and `ready-gate-repair-out-of-diff-edits`.

## What went wrong

- **Every implement lane but four needed a hand step.** Unattended end-to-end: #3895, #3903, #3912, plus #3918's run. Causes: out-of-diff repair fence (2), quota strand (1), iteration timeout (1), plan split unlandable (1), gate-slot refusal treadmill (3 refusals in a row), non-terminating mutant (1).
- **Diff review caught what gates passed, again:** a lane solving a non-problem (#3887), a live-socket reap (#3903), a real-home guard that breaks local gates (#3918), shadowed builder locals (#3916 rebase).
- **Two regressions from this session's own merges** (#3891 → #3902, #3894 → #3920), both total blockers for pipeline verbs, both missed by CI and three diff reviews.
- **Operator-side:** my notification watcher (`tail -F | head -1`) woke me one incident late — ~90 min idle on a finished plan; replaced with a line-count poll. I also acted on a wake late once, and used `pipeline resume` / `run resume` recoveries that turned out to be harmful (now seeded). Merged #3908 before its CI started (it passed).

## Friction (one-off, not seeded)

- Roll-up double-notified one invocation 9 ms apart.
- `daemon self-handoff (real processes)` test flaked twice in CI (25 s, 60 s), passed on rerun.
- Stale TUI process rendered a completed run live (seeded as the TUI revision-follow work; landed).
- `cleanup` silently skips a project still on legacy spec-home keys (no project has them after migration).
