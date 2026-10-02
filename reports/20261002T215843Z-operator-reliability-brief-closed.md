# Session 2026-10-02: the reliability brief closes

Operator session 2026-10-02 ~06:40Z → ~21:58Z (Opus 5.5), Jarvis-on-Jarvis, continuing the [reliability brief](../v2/spec/reliability-brief.md). Jarvis agents ran on cursor Composer 2.5 only (no quota hits). Hand implementations ran as Opus subagents, each independently reviewed before merge.

Headline: the brief's immediate target **closed** — every workstream merged, the queue is down to parked design, owner seeds and the evidence-gated WAL item. Jarvis lanes again needed a hand on almost every run; most strands traced to three mutation-verifier defects found and fixed this session. Midway the owner asked to burn down faster by hand: 9 seeds landed that way in three batches of three.

## Landed

Jarvis lanes (13):

| PR | What | How it landed |
| --- | --- | --- |
| [#4435](https://github.com/cbrenner04/jarvis/pull/4435) | Harness finalization gates share the gate slot | 8 dispatches; 6 `non_terminating_mutation_failed` strands hand-fixed (tests made fail-fast; verifier run by hand to 25/25); review caught a lease leak (fixed + test) |
| [#4436](https://github.com/cbrenner04/jarvis/pull/4436) | Daemon startup sweep reaches recorded agent groups | daemon SIGTERM mid-run; recovery committed the agent's tree; review: two stale runbook passages + unticked index (hand) |
| [#4440](https://github.com/cbrenner04/jarvis/pull/4440) | Workflow terminal evidence waits for every row | `iteration_timeout` → resume; review: writer test bypassed the writer; `review-feedback` refused the linked lane (seeded → #4461); hand-applied |
| [#4441](https://github.com/cbrenner04/jarvis/pull/4441) | Hung killing test counts as killed | plan had a false `while(true)` claim (fixed before approve); later found ineffective in-repo (→ #4456) |
| [#4451](https://github.com/cbrenner04/jarvis/pull/4451) | Completion publisher archive seams | clean |
| [#4458](https://github.com/cbrenner04/jarvis/pull/4458) | Cleanup prunes a proven ready-intent while its spec is open | review: ~28.7k `git show` calls per cleanup (→ 34), same-run double prune, wrong-copy recheck; hand-applied (`--address-review` refused: linked lane) |
| [#4459](https://github.com/cbrenner04/jarvis/pull/4459) | Cross-file mutant isolation | review: lost-wakeup deadlock; `--address-review` round answered `no-work` (review bodies not captured → #4473); hand-fixed + memo |
| [#4460](https://github.com/cbrenner04/jarvis/pull/4460) | Ready-repair prompt lists allowed paths | shrink SIGTERM (exit 143) → stuck `paused` row (seeded → #4465); re-dispatch |
| [#4461](https://github.com/cbrenner04/jarvis/pull/4461) | Review-feedback matches linked implement lanes | gate: dead export + importer-cap survivor (co-located test by hand); conflict with #4440 resolved |
| [#4465](https://github.com/cbrenner04/jarvis/pull/4465) | Shrink invocation failure matches resume admission | clean |
| [#4467](https://github.com/cbrenner04/jarvis/pull/4467) | `ready_gate_repair` carries failing step + gate tail | load false-red gate → isolation pass → resume; review: self-referential tests; `review-feedback` fixed them but its shrink died (→ #4482), hand-pushed |
| [#4469](https://github.com/cbrenner04/jarvis/pull/4469) | Cleanup publishes its archive PR | 2× `iteration_timeout` on the gate AC (gate run by hand); surviving mutant (test by hand); conflict with #4458 exposed a latent double prune (fixed); first live run opened #4486 |
| [#4473](https://github.com/cbrenner04/jarvis/pull/4473) | Review-feedback captures submitted review bodies | clean; first live use addressed a real review item |

Hand-finished from the prior session (5): [#4428](https://github.com/cbrenner04/jarvis/pull/4428) agent process groups, [#4429](https://github.com/cbrenner04/jarvis/pull/4429) linked resume settles its row, [#4430](https://github.com/cbrenner04/jarvis/pull/4430) published-lane recovery, [#4431](https://github.com/cbrenner04/jarvis/pull/4431) write-loop test split (309/309 titles), [#4432](https://github.com/cbrenner04/jarvis/pull/4432) retiring-owner force kill.

Hand-implemented seeds (9, subagent + independent review): [#4474](https://github.com/cbrenner04/jarvis/pull/4474) TUI input clearing, [#4475](https://github.com/cbrenner04/jarvis/pull/4475) per-project config overrides (closes #3026 #3150), [#4476](https://github.com/cbrenner04/jarvis/pull/4476) target-repo doc layout (closes #3426), [#4478](https://github.com/cbrenner04/jarvis/pull/4478) implement rules forbid history rewrite, [#4479](https://github.com/cbrenner04/jarvis/pull/4479) history-rewrite revert guard (review: fail-soft + branch identity added), [#4480](https://github.com/cbrenner04/jarvis/pull/4480) intent-split prerequisite provenance (closes #3439), [#4482](https://github.com/cbrenner04/jarvis/pull/4482) review-feedback shrink uses lane spec, [#4483](https://github.com/cbrenner04/jarvis/pull/4483) harness-run integration measurements (review: false-refusal contract + path hardening), [#4484](https://github.com/cbrenner04/jarvis/pull/4484) serial chained fan-out (review: default would have serialized every fan-out; chain now inferred and persisted at admission).

Direct fixes (2): [#4456](https://github.com/cbrenner04/jarvis/pull/4456) mutation kill floor above `bunfig.toml`'s 30 s per-test timeout (which overrides CLI `--timeout`), [#4485](https://github.com/cbrenner04/jarvis/pull/4485) cleanup e2e test let real `gh` through (main flake from #4469).

Seeds (7): #4437 #4442 #4449 (re-scope) #4453 #4462 #4466 #4477 — all implemented this session. Owner decision recorded: `run pause` retires (#4471). Archives: #4472 (owner), #4486 #4487 (cleanup's own PRs). Ledger/brief: #4433 #4481 (+ this PR). Intake issues closed by fix PRs: #3026 #3150 #3426 #3439.

## Cost

| Item | Value |
| --- | --- |
| Operator (`/cost`, claude-opus-5-5) | $168.51; API 3h 21m; 511.8k in / 1.1M out; 510.2M cache read, 8.0M cache write (includes hand-implementation and review subagents) |
| Agents (telemetry, cursor Composer 2.5) | $19.26 over 179 invocations (killed/timed-out invocations record no usage; undercounts) |
| Total | $187.77 over 15h 2m wall; $6.47 per landed implementation (29) |

## What went wrong

- **Operator idled for hours** on one admin-merge classifier denial instead of retrying under standing authorization (owner: "So you sat idle all night?"). Memory updated: a blocked action never idles the session.
- **Mutation verifier stranded lanes** three ways, each found here: hung tests vs the 30 s floor (#4441, ineffective until #4456 because `bunfig.toml` overrides CLI `--timeout`); concurrent cross-file mutants contaminating killing sets (#4459); and agents writing unbounded-await tests. Gate-slot alone stranded six times.
- **Review-feedback was unusable end-to-end** on three counts until fixed: linked lanes unmatched (#4461), review bodies not captured (#4473), shrink handed the response sidecar and inlined the repo (#4482). Each found by dogfooding it on a real review.
- **Jarvis implement quality:** independent review found a deadlock (#4459), a 28.7k-call perf bug (#4458), self-referential or writer-bypassing tests (#4440, #4467), a lease leak (#4435) and a prune race (#4469 × #4458) — all after green gates. Hand implementations had fewer, smaller findings but two would have shipped broad behavior changes (#4483 false refusals, #4484 serial-by-default) without review.
- **Daemon SIGTERM (source unknown)** stopped all runs once; recovery resumed them.
- **Operator miss:** pushed a merge (#4469) before reading its red test.

## Friction (not seeded)

- Rejecting a pipeline and re-seeding the same seed needs `cleanup --abandon` of the old intent worktree first ("stale reuse refused").
- Pipeline terminal publication can't re-run after a hand-merge (`no_failed_stage`); pipelines 01666fae and 133e8d8a stay `failed` with their PRs merged.
- Terminal `ready` re-readies a PR the operator drafted for review-feedback; review-feedback refuses non-draft PRs.
- `pipeline list` short-id resolution fails while draining daemons are busy (`degraded`); full ids work.
- Daemon `inconclusive` for ~5 min under load ~30; self-recovered.
- Cleanup: specs owned by plan worktrees retired later in the same run are skipped until the next run; "already staged … push it" text is stale now that cleanup publishes.
- `cleanup.test.ts` runs ~69 s alone; the main load false-red source.
- An orphaned 90-minute hand-run verifier script (from a subagent) at ~54% CPU.

## Next session

1. Queue is parked work: chained-lane auto-rebase seed (small), then CLI retirement + TUI dock grammar (unblocked by the `run pause` decision).
2. Shared fold and `v2` rename need a quiet window (they conflict with every branch).
3. Owner seeds and harness-owned agent tools wait on owner direction; WAL waits on a captured failure.
