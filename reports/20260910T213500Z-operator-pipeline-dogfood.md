# 2026-09-10 operator session — pipeline dogfood after #3734

Agent order `codex, claude` (cursor and opencode out). Machine opened clean: load 2.3, zero orphaned `bun test` processes.

## Headline: a `full-review` pipeline ran seed → ready PR unattended

Pipeline `bf7ccea1`, 39 minutes, from `v2/spec/seeds/one-artifact-per-bullet-rejects-well-formed-bullets.md` to [#3741](https://github.com/cbrenner04/jarvis/pull/3741) — criteria ticked, gate green, draft→ready flipped, PR published. The only operator actions were the two gate approvals. Stage timings: intent ~7m, plan ~11m, implement ~15m.

This is the first time it has happened, and the cause is verifiable rather than inferred: at implement dispatch the managed worktree contained the full spec tree (`00-*.md`, `index.md`, `intent.md`) — the exact condition absent from all three failing lanes on 2026-09-09. [#3734](https://github.com/cbrenner04/jarvis/pull/3734) closed [[chained-implement-cannot-tick-its-own-criteria]] in practice.

**The agent fallback order carried the whole session by itself.** 59 invocations: codex hit quota **30/30** and cascaded to claude **29/29 `ok`**, with no intervention. Agent cost $15.38, all of it claude (codex quota exits are free).

## The gates passed a defective change — again

PR #3741 arrived with green CI, 8/8 ticked acceptance criteria, and hand mutation-verification (reverting the production file fails 4 of its new tests). An independent subagent diff review still found both new exemptions **fail open**, contradicting the spec's own "unmatched wording fails closed" decision:

- `isSharedDecisionBullet` matched a bare `the same` / `identical`, so `Creates \`a.ts\` and its test \`a.test.ts\` in the same directory` was exempt.
- Checked first, it short-circuited the other exemption's mixed-claim carve-out, making the `mixes exempt wording with a build claim` refusal **unreachable** for any bullet carrying those markers. That refusal has a ticked acceptance criterion, whose test picked the one phrasing that happened to work.
- Bare `green` and `stops` in the preservation vocabulary matched prose about new work.

All three fixed in-branch before merge, with five regression cases and two verified-killed mutants; the spec's Decisions were corrected to claim what is true, and the prompt plus three docs were fixed — they described a rule ("no build verb attached to a *different* artifact") the code never implemented. **The standing rule holds: never merge an autonomous implement without an independent diff review.**

## The annotated-index-link defect is three call sites, not one

[#3732](https://github.com/cbrenner04/jarvis/pull/3732) fixed publication landing. This session found and fixed the other two:

1. [#3739](https://github.com/cbrenner04/jarvis/pull/3739) — the plan-draft contract (`shared/module-boundary-surfaces.ts`), after it blocked 2 of 3 plan lanes with `contract_miss` over indexes that linked every subspec.
2. [#3744](https://github.com/cbrenner04/jarvis/pull/3744) — `shared/spec-parser.ts`, **the worst of the three, because it does not refuse.** `parseSpec` returned `linkedSubspecs: 0` for a freshly-merged spec with two linked subspecs and **16 unchecked criteria**, so `jarvis run workflow implement` exited `implement.already_complete: requested spec has no unchecked non-human-only acceptance criteria`. A spec with all its work outstanding reported as having none.

Three lexical link patterns in three modules is the root; one shared link parser would have made this a single fix. Also recorded, not fixed: the operator message is wrong for that shape — routing returns `requires_index` while the CLI prints `already_complete`.

## The settlement-seam P0 is finished

[#3745](https://github.com/cbrenner04/jarvis/pull/3745), picking up the abandoned WIP branch. Stage settlement now derives from the entry run's durable rows through one algorithm with one daemon owner at four call points; liveness is the only in-memory input. The `settlement_deferred` marker, both redrive predicates, `resumeDrivesDeferredSettlement` and the wedged-stage incident are gone.

Four defects were in the WIP itself:

1. **Stale-snapshot read in `resumePipeline`** — derived state came from the post-settlement rows while every later read used the pre-settlement snapshot. This is the recovery's own signature defect class.
2. Resume **refused the rows it had just written** instead of continuing what settlement unblocked.
3. A stage settled `failed` **left its suffix `pending`**, so the pipeline derived `failed` while reopen refused it as `malformed_continuation`.
4. The **durable-row liveness check was dropped**, so a run whose step rows did not exist yet rolled up `killed` and its stage was failed while the run was still `in-progress`.

The terminal-stage-write structural guard was extended to follow those writes into `persistence/`, where they moved — otherwise it would have gone half-inert, the standing green-gate-over-a-no-op mode.

**Live evidence for the P0, unprompted:** after `bf7ccea1`'s three run rows all read `completed`/`not-live`, its pipeline stage still read `implement running`.

## A live pipeline strands itself on its own merge

An `awaiting-approval` pipeline whose owning daemon was superseded reports `ownerIdentity: null` and refuses **every** owner-routed verb with `pipeline_no_live_owner`, which no `jarvis daemon start` clears. A `failed` pipeline routes fine via the deterministic-socket fallback. Observed directly: `ed52b850` was stranded while `280ad4c4` resumed normally at the same moment. Since merging stage PRs is how a pipeline lands its own work, any source merge at a gate does this. Recovery was to merge the intent PR and drive the stage standalone.

## Circuit-breaker fired once

The `recover-validates-on-disk-plan-stage` plan lane tripped the plan-contract gate twice — index-link, then one-artifact-per-bullet counting `index.md` and `intent.md` where the bullet names them as *the content of the fixture under test*. Hand-landed as [#3742](https://github.com/cbrenner04/jarvis/pull/3742); the draft was sound both times and the only content edit was rewording that one bullet. The tree was validated against `normalizePlanDraftSpecDir`, the same contract the harness runs, before the PR.

That is the fifth instance of the "strict lexical patterns fail closed on well-formed prose" class — and it is what #3741 titles itself as fixing. #3741's exemptions are wording-markers and do not cover a bullet that merely *mentions* a file.

## Seeds

- `standalone-plan-redispatch-retires-a-never-landed-lane` — failed *pipeline* plan resume already retires a never-landed lane whose `HEAD` is not descended from base; standalone `plan` re-dispatch refuses it, so each occurrence costs a `cleanup --abandon` plus an identical re-issue. Recorded unseeded after six occurrences on 2026-09-07; recurred today.
- `superseded-daemon-releases-run-ownership` — extended with the pipeline-verb half above.

## Landed

| PR | What |
| --- | --- |
| [#3736](https://github.com/cbrenner04/jarvis/pull/3736), [#3737](https://github.com/cbrenner04/jarvis/pull/3737) | Intent splits (5 ready-intents, 2 seeds reaped) |
| [#3739](https://github.com/cbrenner04/jarvis/pull/3739) | Annotated index links in the plan-draft contract |
| [#3741](https://github.com/cbrenner04/jarvis/pull/3741) | The pipeline-produced implementation, with review fixes |
| [#3742](https://github.com/cbrenner04/jarvis/pull/3742) | Hand-landed plan + 2 seeds |
| [#3743](https://github.com/cbrenner04/jarvis/pull/3743) | Plan for the mutation-survivor confirmation |
| [#3744](https://github.com/cbrenner04/jarvis/pull/3744) | Annotated index links in the spec parser |

Closed as subsumed by #3741: #3738, #3740. Open at handoff: [#3745](https://github.com/cbrenner04/jarvis/pull/3745).

## Parallelization notes

Three pipelines fanned out cleanly from the start: three intent stages concurrently at load 2.3, then three plan stages concurrently, zero watchdog false-kills and zero idle-output stalls. The ceiling was never lane count. Every failure this session was a content or contract defect, not contention — a marked change from prior sessions.

One process note: a `test:v2` run started with `run_in_background` inherits the session's working directory but its output was truncated by piping to `tail`, which briefly read as a passing run. Redirect to a file and grep it.
