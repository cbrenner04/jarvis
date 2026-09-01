# Session report — 2026-08-31/09-01 continuation (strand-class fixes + external-spec chain)

Operator-present session continuing the structural-recovery brief. Agent order codex→cursor→claude (codex quota'd; cursor de-facto actuator). Focus emerged mid-session: the recurring implement-strand tax (biome-commit + surviving-mutation) was the dominant cost, so the session pivoted to fixing those classes structurally rather than hand-finishing each run.

## Implementation PRs landed

| PR | What |
| --- | --- |
| [#3272](https://github.com/cbrenner04/jarvis/pull/3272) | **admit-external-implement-specs** — admits `plan.commit:false` plan trees under `~/.jarvis/specs/<safeId>/plans/`; external chain lane 1 (SHIP-reviewed, subagent) |
| [#3285](https://github.com/cbrenner04/jarvis/pull/3285) | **Pipeline gate-approval HARD REGRESSION FIXED** — `approve` passed the `"default"` sentinel as a scoped branchKey, skipping the default-lane prefix; `normalizeContinuationBranchKey`→whole-pipeline + `resume` recovers a `pending` strand. Operator-confirmed regression, bisected to #3170 |
| [#3288](https://github.com/cbrenner04/jarvis/pull/3288) | **render-coverage** resolves the observer map from the worktree under test (closes the #3199 bootstrap trap) |
| [#3289](https://github.com/cbrenner04/jarvis/pull/3289) | **pipeline-stages-target-main** — plan/implement stage PRs target `main`, no stacking; external chain lane 3 |
| [#3290](https://github.com/cbrenner04/jarvis/pull/3290) | **red-x TUI** — needs-attention failure `✗` paints red (operator ask) |
| [#3291](https://github.com/cbrenner04/jarvis/pull/3291) | **Biome-commit strand FIXED structurally** — terminal completion commit is best-effort on lint (extends #3242's checkpoint principle to the terminal boundary); ends the `completion_commit_failed`-on-lint strand. Plus an implement write-step complexity/`biome-ignore` prompt rule |
| [#3292](https://github.com/cbrenner04/jarvis/pull/3292) | **Per-turn commit history** (operator #1) — one commit per turn (write iterations + shrink + each mutating review pass), unique subjects, per-turn attribution; removes `preImplementResetAnchor`/mixed-reset collapse + `publishedCommitAgent` substitution. Supersedes #3234 |
| route (`20260831T200443Z-route-external-implement-spec-trees`) | **route-external-implement-spec-trees** — execution-loop routing of external trees; external chain lane 2. Re-run on the #3291 build to validate the strand fix end-to-end (landing) |

Support PRs: #3268 (spec archival), #3270/#3277/#3280/#3283/#3284 (plans), #3276/#3282 (intents), #3278 (sidecar-filter impl) + #3279 (fabricated-filename test fix), #3287 (resume-error seed), #3275/#3281/#3293 (seeds/ledger/brief). Chess-mvp-yolo home-screen recovery guidance provided (Makefile repair-fence, #3040).

## The throughline (why the pivot)

Every implement stranded on one of two classes: the **biome-complexity/unused-lint terminal-commit strand** (`completion_commit_failed`, complete work left uncommitted) or a **surviving mutation** (uncovered guard). Each was hand-finished (admit biome, #3285/#3288/#3289 mutations, route/render biome). Recognizing the fix-on-recurrence rule (the runbook flags "recurs across sessions"), the session drove the structural fix #3291 — extend #3242's "a durability commit is never gated by lint" to the terminal completion commit. #3291 needs a daemon bounce to take effect; route's final re-run is on the bounced build to validate it.

## Key findings / seeds

- **Pipeline gate-approval regression** (#3285): the `"default"` branchKey sentinel was treated as a scoped fan-out suffix through the front-door dispatch rework (#3170), skipping the default-lane prefix on live approval; the startup continuation sweep passed `undefined` (whole-pipeline), which is why only a daemon bounce recovered it.
- **Resume admission-gate refusals are invisible** ([[resume-surfaces-admission-gate-refusal]], #3287): a `run resume` refused by the descendant / `stale reuse refused` gate writes its reason only to `daemon.log`; the CLI "fails immediately" and the TUI shows nothing. Operator-observed.
- **Per-turn commit history** was hand-rebased onto current main after conflicting with #3290/#3291 (its base was stale) — resolved `workflow-runner.ts` (`preImplementResetAnchor` removal) + the runbook boundary text.

## Process notes

- Redundant merge-waiter background loops cluttered the task view; fixed to one waiter per PR and never `&` inside a `run_in_background` command.
- Heavy merge cadence rotated the daemon under the operator's live chess pipeline (runbook says batch merges at idle) — acknowledged and throttled.
- v1 `rendered-snapshots` / `write-loop.test.ts` timing tests flake under full-aggregate CI load; each needed a CI re-run.

## Cost

Operator opus-4-8 `/cost` figures TBD (ask at close); cumulative CSVs under `reports/` to be updated. Per-run agent cost queryable in `~/.jarvis/telemetry.jsonl` by `run_id`.

## Issues

No closures this session. #3122 (external implement) commented with chain progress; closes when route + chain + archive land. #3040 (ready-gate repair dead-end for out-of-diff fixes) is the Makefile-repair-fence the operator hit on chess — genuine open backlog.
