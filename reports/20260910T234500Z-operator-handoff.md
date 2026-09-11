# 2026-09-10 operator session — handoff

Continues [`20260910T213500Z-operator-pipeline-dogfood.md`](./20260910T213500Z-operator-pipeline-dogfood.md), which covers the session's first block. Written at a session switch for context, not at a natural stopping point: several lanes are mid-flight and are described below so the next session does not re-derive them.

## State at handoff

**Open PRs (all mine, all green or in CI):**

| PR | What | Next step |
| --- | --- | --- |
| [#3757](https://github.com/cbrenner04/jarvis/pull/3757) | **Unblocks a red `main`** — removes the `admissionStateForTest` production test seam #3747 added | Merge first |
| [#3758](https://github.com/cbrenner04/jarvis/pull/3758) | Bare `index.md`/`intent.md` no longer count as artifacts | Merge, then re-drive the two failed plan stages below |
| [#3752](https://github.com/cbrenner04/jarvis/pull/3752), [#3753](https://github.com/cbrenner04/jarvis/pull/3753), [#3754](https://github.com/cbrenner04/jarvis/pull/3754) | Pipeline intent stages (5 ready-intents, 3 seeds reaped) | Merge in stage order |
| [#3755](https://github.com/cbrenner04/jarvis/pull/3755), [#3756](https://github.com/cbrenner04/jarvis/pull/3756) | Plan stages — reviewed, not yet read by me | **Review before merging** |

**`main` was red on `bun run test:shared`** when this was written; #3757 is the fix. Verify green before driving anything.

**Pipelines:**

- `f930a0f1` (`skipped-successor-strands-a-recovered-lane`) — `awaiting-approval` at `approve-plan` for the head lane `provisional-skip-provenance-in-state-store`. Its intent fanned into a **strict serial chain** of four lanes: provenance → stage-success reopen → branch-resume admission → refusal messaging. Only the head was approved, deliberately; approve each successor after its prerequisite lands.
- `135c1e08` (`cleanup-archives-harness-staging-outside-the-spec-home`) — plan `contract_miss` on the artifact-count bullet #3758 fixes. Re-drive after that merges.
- `9b1c81aa` (`standalone-plan-redispatch-retires-a-never-landed-lane`) — plan failed `harness_failure` / `nextAction: stop` while its entry run reads `completed` with `outcomeKind: "done"`. **Not diagnosed.** Worth a look: a stage failing `harness_failure` over a completed entry run is the rollup-versus-durable-rows shape, and the settlement work merged this session was supposed to close that class.
- `ed52b850`, `280ad4c4`, `bf7ccea1` — terminal or stranded, described in the first report. `ed52b850` is unreachable by any verb (`pipeline_no_live_owner`, superseded daemon).

**Runs:** the implement for `20260910T230153Z-surviving-mutation-settlement-records-killing-set` failed **`quota_exhausted`** — both rungs out at the time. Quota has since recovered, so re-dispatch it; the spec is on `main` and unstarted.

**Open specs:** `20260910T211500Z-recover-validates-on-disk-plan-stage` (subspec 00 landed in [#3749](https://github.com/cbrenner04/jarvis/pull/3749); **subspec 01 is 0/6 and unstarted**), and `20260910T230153Z-surviving-mutation-settlement-records-killing-set` (0/2, the quota-failed lane above).

## Two things I got wrong, both worth carrying forward

**A `v2/src`-only change can break `test:shared`.** #3747 added a production test seam; `guard-production-test-flags` catches exactly that, but it lives in the `test:shared` slice while scanning v2 source. I ran the v2 pair per the scope rule and merged a red `main`. When a change touches anything a guard scans, run the slice that *owns the guard*, not the slice that owns the files.

**Over-correcting on a review finding can be worse than the finding.** A reviewer noted the retirement allowlist had no self-check. I added two assertions; one ("every allowlisted title existed at the merge base") is only true while the retiring branch is unmerged, so it red-gated every later branch the moment it landed. Fixed in [#3748](https://github.com/cbrenner04/jarvis/pull/3748). A guard whose correctness depends on when it runs is not a guard.

## Cleanup

**Do not run bulk `jarvis cleanup` apply without checking the preview.** It still previews `archive: <repo>/.jarvis-intent-stage -> <repo>/completed/.jarvis-intent-stage`, which would create a stray `completed/` at the repository root — the open `cleanup-archives-harness-staging-outside-the-spec-home` seed, which is itself mid-pipeline as `135c1e08`. Session archival and ready-intent reaping were done by hand in [#3750](https://github.com/cbrenner04/jarvis/pull/3750). Managed worktrees from this session are still on disk and want retiring individually.

## Cost

Agent side, measured from `~/.jarvis/telemetry.jsonl` for this session's window: **77 invocations, $35.53**, split codex 39 / claude 38 — codex `quota` on all 39, claude `ok` on all 38. The configured fallback order absorbed every dispatch with no intervention. Operator-side `/cost` was requested but not captured before the switch; the cumulative CSVs under `reports/` are **not** updated for this session and still need both figures.
