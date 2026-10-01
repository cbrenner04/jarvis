# Session 2026-09-30 (second): pipeline lanes, mutation gate repair, PR hygiene

Operator session 2026-09-30 15:00Z→2026-10-01 01:00Z (Opus 5.5), Jarvis-on-Jarvis, every agent invocation on cursor Composer 2.5. **22 fixes/implements landed**, 2 seed PRs, plus 9 intent and 5 plan PRs. Chains closed: finished_at (#4263 #4282), rollup (#4260 #4295), review roles (#4266 #4278), superseded-PR settle + policy (#4268 #4290), telemetry retention (#4267). Every implement lane needed review fixes before merge; reviews caught a `run list` 10 s → 0.2 s regression, an order-insensitive mutation skip, a review-feedback run that could never complete, a month-loss race in the telemetry roll, a two-dot diff that kept cleanup from ever firing, and a shrink revert to an unverified tree.

## Fixes and implements

| PR | What |
| --- | --- |
| [#4260](https://github.com/cbrenner04/jarvis/pull/4260) | Legitimately skipped durable successors roll up completed (+ lazy indexed prior-lane lookup, latest prior row decides) |
| [#4263](https://github.com/cbrenner04/jarvis/pull/4263) | Terminal completion-boundary fallback stamps `finished_at` |
| [#4264](https://github.com/cbrenner04/jarvis/pull/4264) | Mutation verifier ignores whitespace-only reflows (ordered contiguous token match) |
| [#4266](https://github.com/cbrenner04/jarvis/pull/4266) | Implement review roles falsifiability fragment |
| [#4267](https://github.com/cbrenner04/jarvis/pull/4267) | Roll telemetry monthly and retain closed months (atomic staging rename, no archive overwrite) |
| [#4268](https://github.com/cbrenner04/jarvis/pull/4268) | Pipeline supersede policy resolves at project admission |
| [#4278](https://github.com/cbrenner04/jarvis/pull/4278) | Plan review roles falsifiability fragment |
| [#4282](https://github.com/cbrenner04/jarvis/pull/4282) | Stamped migration 033 backfills terminal null `finished_at` |
| [#4287](https://github.com/cbrenner04/jarvis/pull/4287) | Pipeline verbs accept full ids against a degraded listing |
| [#4290](https://github.com/cbrenner04/jarvis/pull/4290) | Terminal publication settles superseded preceding stage PRs |
| [#4292](https://github.com/cbrenner04/jarvis/pull/4292) | Pipeline plan stage bases on the fetched default branch |
| [#4293](https://github.com/cbrenner04/jarvis/pull/4293) | Mutation reprompts name the co-located killing-test path |
| [#4294](https://github.com/cbrenner04/jarvis/pull/4294) | Review-feedback preset write step lands fixes on the lane PR (agent-authored response sidecar) |
| [#4295](https://github.com/cbrenner04/jarvis/pull/4295) | Reopened implement stage with no new work settles succeeded |
| [#4296](https://github.com/cbrenner04/jarvis/pull/4296) | Cleanup retires subsumed plan lanes and names landed-elsewhere worktrees |
| [#4297](https://github.com/cbrenner04/jarvis/pull/4297) | `test:confirm:live`: serial confirmation runs the live roster, never frozen `v1/` |
| [#4300](https://github.com/cbrenner04/jarvis/pull/4300) | Shrink re-runs mutation verification before publication |
| [#4301](https://github.com/cbrenner04/jarvis/pull/4301) | `invocation_completed` rows carry usage for non-ok exits (clean rebuild of #4286) |
| [#4265](https://github.com/cbrenner04/jarvis/pull/4265) | Direct fix: boot headroom for group-mode subprocess timeout tests |
| [#4271](https://github.com/cbrenner04/jarvis/pull/4271) | Direct fix: falsifiable supersede policy tests |
| [#4291](https://github.com/cbrenner04/jarvis/pull/4291) | Direct fix: cleanup never archives seeds/ready-intents as retired-worktree artifacts |
| [#4299](https://github.com/cbrenner04/jarvis/pull/4299) | Direct fix: repair fence admits co-located tests of in-diff production files |

## Seeds and bookkeeping

Seeds: [#4252](https://github.com/cbrenner04/jarvis/pull/4252) [#4270](https://github.com/cbrenner04/jarvis/pull/4270) (cleanup-retires; shrink-preserves-mutation-coverage, pipeline-verbs full ids, plan-stage fetched base — all consumed and landed this session). Closeout PR adds `tui-revision-follow-replaces-itself`, `harness-commits-stay-in-run-scope`, `terminal-publication-accepts-operator-merged-pr`, `closed-lane-is-not-republished`; archives 18 spec dirs; reaps 14 ready-intents; ledger + brief refreshed. Issues closed: #4003 (#4168 #4237), #3029 (#3670 #3734).

Intent PRs: [#4247](https://github.com/cbrenner04/jarvis/pull/4247) [#4248](https://github.com/cbrenner04/jarvis/pull/4248) [#4251](https://github.com/cbrenner04/jarvis/pull/4251) [#4256](https://github.com/cbrenner04/jarvis/pull/4256) [#4257](https://github.com/cbrenner04/jarvis/pull/4257) [#4274](https://github.com/cbrenner04/jarvis/pull/4274) [#4275](https://github.com/cbrenner04/jarvis/pull/4275) [#4276](https://github.com/cbrenner04/jarvis/pull/4276) [#4277](https://github.com/cbrenner04/jarvis/pull/4277). Plan PRs: [#4250](https://github.com/cbrenner04/jarvis/pull/4250) [#4253](https://github.com/cbrenner04/jarvis/pull/4253) [#4288](https://github.com/cbrenner04/jarvis/pull/4288) [#4289](https://github.com/cbrenner04/jarvis/pull/4289) [#4298](https://github.com/cbrenner04/jarvis/pull/4298). Closed unmerged: plan PRs #4254 #4255 #4258 #4259 #4261 #4262 #4269 #4272 #4273 #4279 #4280 #4281 #4283 #4284 #4285 (subsumed); #4249 (fan-out rejected, hand-assembled); #4286 (stale-main sweep, rebuilt as #4301); #4302 (harness duplicate republication).

## Friction

- **Operator error:** merged 9 intent PRs after their pipelines' next stages had consumed them; 4 re-added stale ready-intents. User corrected: close intent/plan PRs as subsumed, never merge; brief rule fixed.
- Publication-time surviving mutants on nearly every lane; `importer-discovery-cap-exceeded` ×4. Root causes: shrink deleted/reshaped co-located tests (fixed #4300), reprompt didn't name the test file (#4293), repair fence refused the new co-located test (#4299), `run resume` replays the recorded survivor instead of re-verifying (planned in `publication-inflow-mutation-repair`).
- Harness commits outside run scope ×3 (d39f5071c, bf1e5cbc6 ~30 stale files, 658c18963 broke an unrelated test) — seeded.
- Duplicate PR republication of a closed lane (#4302) — seeded. Terminal publication fails after operator merge (998a665f, 66f666ad) — seeded.
- Degraded `pipeline list` refused full ids for 2–8 min after every source merge (fixed #4287); plan stages branched from stale local main ×2 (fixed #4292).
- Cleanup would have archived ready-intents as artifacts (found in dry-run, fixed #4291).
- Up to 4 daemon generations and load 35–45 with 8 implements live; load-induced gate timeouts and `iteration_timeout`s. Notification waits dropped on IPC loss during handoffs.
- Operator TUI nested 19 processes across self-follow re-execs and broke — seeded.
- Auto-mode denied subagent `test:v2` / lane-worktree edits three times; user approved hand-finishes for #4278, #4300, #4303.
- Leaked launchd-parented `bun -e` fixture orphans (51248, 62162).

## Open at close (carry forward)

- #4303 review-feedback item traceability: reviewed, main merged in (ad44e6ffb), awaiting two green CI → merge.
- Ready-intents dispatchable: `agent-bindings-recover-usage-on-failed-settlement`, `publication-inflow-mutation-repair` (carry the reviewed decisions: re-verify HEAD before repair, revert weakened killing tests, revert uncommitted edits on timeout), `retire-superseded-pipeline-branches`.
- New P1 seeds: harness-commits-stay-in-run-scope, terminal-publication-accepts-operator-merged-pr, closed-lane-is-not-republished.
- User handoff: worktree `~/.jarvis/worktrees/jarvis/test-retention-check`, the base-ref probe worktree in `/var/folders`, local branches `closeout-20260930-structural-recovery` `config/home-models-2026-09` `docs/draft-until-ready`.

## Cost

| | Cost | Notes |
| --- | --- | --- |
| Operator (`/cost`) | $131.60 | claude-opus-5-5 (2h50m API, 9h35m wall); 490.5k in, 763.0k out |
| Agents (telemetry) | $39.26 | 317 invocations, 137 runs; cursor Composer 2.5 only |
| **Total** | $170.86 | 22 fixes/implements → $7.77 per landed fix |
