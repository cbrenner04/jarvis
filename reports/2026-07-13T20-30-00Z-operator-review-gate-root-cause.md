# Operator session — 2026-07-13T20-00-00Z

Backlog audit, review-gate root-cause, and the first exercise of the debate path.

## What shipped

| PR | What | Harness | Agent |
| --- | --- | --- | --- |
| [#1481](https://github.com/cbrenner04/jarvis/pull/1481) | Backlog housekeeping: retire 8 landed seeds + 1 ready-intent, delete 4 misframed help intents, archive `claude-streams-output-to-watchdog`, rescue the stranded `workflow-wedged-run-killable` spec, correct both runbooks | hand | — |
| [#1482](https://github.com/cbrenner04/jarvis/pull/1482) | Plan: `intent-review-prompts-render` | **v2** `run workflow plan` | claude |
| [#1484](https://github.com/cbrenner04/jarvis/pull/1484) | **Impl: render intent review prompts** — the P0 | **v2** `run workflow implement` | claude |
| [#1485](https://github.com/cbrenner04/jarvis/pull/1485) | **Impl: review steps emit log events** | **v1** `jarvis1 run` | claude |
| [#1487](https://github.com/cbrenner04/jarvis/pull/1487) | Intent split: `v2-has-no-help` → 4 ready-intents | **v2** `intent-reviewed` | claude |
| [#1489](https://github.com/cbrenner04/jarvis/pull/1489) | Intent split: `blocked-run-destroys-its-worktree` → 2 ready-intents | **v2** `intent-reviewed` | claude |
| [#1490](https://github.com/cbrenner04/jarvis/pull/1490) | Plan: `blocked-run-retains-worktree-and-branch` | **v2** `plan-reviewed` (debate) | claude |
| [#1483](https://github.com/cbrenner04/jarvis/pull/1483), [#1486](https://github.com/cbrenner04/jarvis/pull/1486), [#1488](https://github.com/cbrenner04/jarvis/pull/1488), [#1491](https://github.com/cbrenner04/jarvis/pull/1491) | Seeds (5 new harness gaps) | hand | — |

Two implementation PRs landed: **#1484** and **#1485**.

## The review gate: root-caused, and it works

The standing "the review step is a silent no-op" report was **three wrong diagnoses deep**.
All three inferred "no agent ran" from an empty log. Telemetry always showed real 21–83s
critic and actuator invocations.

Two real defects were hiding behind that empty log, and both are now fixed:

1. **The critic's prompt was the literal string `"intent.prompt.review"`** — never resolved
   through the prompt registry, so `prompts/intent/review*.md` were dead files. Fixed by
   #1484. Verified: the critic now runs on rendered prompts and the actuator fires on a
   non-empty verdict.
2. **The review run row emitted no log events** (`runReviewStep` got no `logSink`), so
   `jarvis run log <review-run-id>` returned nothing regardless of what ran. Fixed by #1485.
   Verified: the review row now logs `iteration_started` → `loop_finished`.

Residual, backlogged: a workflow's run id goes terminal when only its **first step** is done
(seed `workflow-completes-before-its-review-step`, #1488). Real, but the operator already
knew to read the review row's own id.

**Debate works — and had never once run.** All-time telemetry showed zero `adversary`,
`advocate`, `adjudicator` invocations. Exercised via `plan-reviewed`: adversary (11s) →
advocate (47s) → adjudicator (29s) → actuator (7s), all claude, all `exit_kind: ok`,
producing a well-formed spec plus `verdict-plan.md`. Caveat: the `review-debate` step has no
durable run row at all, so it is invisible to `jarvis run log`.

## The recurring failure class

Every defect found this session is the same shape: **a terminal status asserted without the
evidence that would substantiate it.**

- `implement-reports-done-with-unticked-criteria` (#1491) — **the worst.** Run `f9d556ed`:
  7 minutes of work, `done`/`completed`, branch head still equal to `main`, **0/5 acceptance
  criteria ticked**, work left uncommitted, no commit, no PR. Nondeterministic — #1484's run
  committed and published correctly on the same preset the same day.
- `blocked-run-destroys-its-worktree` (#1483) — a `blocked` run deleted its worktree, branch,
  and blocker text after codex ran 174s (`exit_kind: ok`). Paid work and the only evidence of
  why it blocked, both gone.
- `v2-ready-gate-omits-lint-and-format` (#1486) — `ready-finalize.ts` calls `bun run ready`
  with no tier, and the non-`full` tier skips biome and `lint:md`. #1484's own run introduced
  a format error, passed its gate, and CI went red on it. The concrete mechanism behind the
  existing `local-gate-green-while-ci-red`.
- `triage-blind-to-v2-worktree-home` (#1483) — `triage --merge` only knows
  `<repo>/.worktree/`, so every v2 PR falls back to raw `gh` — which skips the one gate
  (`lint:md`) that PR CI does not run. Both lint gates bypassed for v2 work.
- `v2-workflow-pr-stays-draft-and-untitled` (#1483) — every v2 PR publishes draft, titled
  `jarvis: complete run`. Hand `gh pr ready` + retitle each time.

**Stop trusting `completed/` as a signal.** Four archived-complete specs still reproduced
their bugs this session (`blocked-outcome-with-no-blocker-text`, `v2-pr-title-from-workflow`,
`v2-pr-description-summarizes-change`, and the preflight pair). `v2-pr-title-from-workflow` is
not a regression — it only ever wired the *intent* path; `plan` and `implement` never passed
`creationTitle`, so they fall through to the hardcoded default.

## Corrections to the record

- **Retracted the claude pool-contention folklore.** "claude-haiku stalls on pool contention"
  and "claude-sonnet-5 is too slow to be patch primary" were both misattributions of the
  watchdog blindness fixed by `claude-streams-output-to-watchdog`. Zero output was a missing
  measurement, not a starved or slow agent. Claude is a valid patch primary again.
- **Agent order:** v1 already led with claude everywhere. The gap was v2's top-level `agents`
  key (`codex` first) — now `["claude","codex","cursor"]`. Every run after the flip used
  claude.
- The prior prioritization doc tracked **ten** "in-flight" specs that had already completed,
  and carried **nine** seeds for shipped work.

## Cost

Jarvis spend for v2 is **unattributable**: all **16** real v2 invocations this session carry
`cost_usd: null` / `usage_source: unavailable`. The one v1 run recorded **$6.84** normally.

**Correction.** This report originally said "139 invocations". That count was wrong: 93% of
`~/.jarvis/telemetry.jsonl` was **test-fixture data** — the suite wrote `project: demo` rows
into the operator's real home on every `bun run test`. Filtering them leaves 16 real
invocations. The cost finding is unchanged (16 of 16 carry no cost); only the count was
inflated. Seed `tests-write-telemetry-to-the-operator-home`; fixed by #1496; the file and
`v2.sqlite` have been purged with backups.

**`runs.jsonl` is clean** (0 of 6,173 rows polluted), so no prior session's cost sheets are
affected. It simply has no v2 rows at all — v2 writes only `telemetry.jsonl`. That, not the
pollution, is why v2 cost is dark: seed `shared-invocation-loses-cost-and-claude-output`.

Operator cost: **$27.09** (opus $27.08 + haiku $0.0017); api 0:33:54, wall 4:22:33.
Observed total: **$33.93**.

`efficiency.csv`'s `tokens_per_completed_spec` is **blank** for this row on purpose:
`session_active_tokens` covers only the v1 run, because v2 records no tokens at all. Dividing
partial tokens across both completed specs would publish a trend point that is simply wrong.
Blank until `shared-invocation-loses-cost-and-claude-output` ships.
