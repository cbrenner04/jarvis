# Operator session — 2026-07-30 (04:10–14:00Z)

Surface: v2 (`jarvis`). Goal: work the `v2/spec/implement-queue.md` queue, driving everything through implementation, and at minimum close the phase gate (in-flight specs + slot-before intents). Agent order: `codex,cursor,claude` for the first two hours, then `cursor,codex,claude`.

## Outcome

**Phase gate closed, and the pipeline phase went from slices 1–2 through slices 3, 4, and the front of 5.** 45 PRs merged: 19 implementations, 20 plans, 4 intents, 2 operator spec fixes. Two specs carried over.

`jarvis pipeline start | list | wait` and daemon-side approve/reject/resume now exist on `main`, with the approval/resume CLI (#2335) and terminal-action validation (#2336) landed. Not yet usable end to end: terminal-action *execution* and settlement are still queued intents, and slice 6 (the one integration proof) has not been planned.

## Implementation PRs (17)

| PR | Spec | Agent |
| --- | --- | --- |
| [#2297](https://github.com/cbrenner04/jarvis/pull/2297) | intent-split-multi-surface-regression | codex |
| [#2298](https://github.com/cbrenner04/jarvis/pull/2298) | plan-blocks-unmet-split-dependencies | codex |
| [#2302](https://github.com/cbrenner04/jarvis/pull/2302) | cleanup-without-listening-daemon | codex |
| [#2303](https://github.com/cbrenner04/jarvis/pull/2303) | plan-emits-one-subspec-per-module-boundary (5 subspecs) | codex |
| [#2304](https://github.com/cbrenner04/jarvis/pull/2304) | pipeline-store-enumeration | codex |
| [#2310](https://github.com/cbrenner04/jarvis/pull/2310) | pipeline-daemon-observation-and-wait | codex |
| [#2311](https://github.com/cbrenner04/jarvis/pull/2311) | terminal-settle-cancels-repair-agent-and-releases-lock | codex |
| [#2313](https://github.com/cbrenner04/jarvis/pull/2313) | ready-gate-red-in-untouched-files-is-out-of-scope (5 subspecs, 34 files) | codex |
| [#2315](https://github.com/cbrenner04/jarvis/pull/2315) | cleanup-prunes-merged-dead-branches | cursor |
| [#2316](https://github.com/cbrenner04/jarvis/pull/2316) | plan-split-index-orders-by-dependency | cursor |
| [#2320](https://github.com/cbrenner04/jarvis/pull/2320) | pipeline-durable-approval-and-reopen-state (8 subspecs) | cursor |
| [#2322](https://github.com/cbrenner04/jarvis/pull/2322) | store-timestamps-terminal-reconciliation | cursor |
| [#2323](https://github.com/cbrenner04/jarvis/pull/2323) | plan-split-preserves-draft-scope | cursor |
| [#2324](https://github.com/cbrenner04/jarvis/pull/2324) | pipeline-posture-table-pins-cli-review-acceptance | cursor |
| [#2326](https://github.com/cbrenner04/jarvis/pull/2326) | workflow-collapse-drops-test-flag | cursor |
| [#2328](https://github.com/cbrenner04/jarvis/pull/2328) | pipeline-operator-cli (slice 4 CLI) | cursor |
| [#2330](https://github.com/cbrenner04/jarvis/pull/2330) | pipeline-daemon-approval-and-stage-resume (slice 3 daemon) | cursor |
| [#2335](https://github.com/cbrenner04/jarvis/pull/2335) | pipeline-approval-resume-cli | cursor |
| [#2336](https://github.com/cbrenner04/jarvis/pull/2336) | configure-and-validate-pipeline-terminal-action (slice 5 front) | cursor |

## Plan and intent PRs (26)

Intents: #2288 #2289 #2290 #2291 (pipeline slices 3–6, each fanned out by surface — the split discipline from #2277 working end to end).

Plans: #2285 #2286 #2292 #2293 #2294 #2295 #2296 #2299 #2300 #2305 #2306 #2307 #2317 #2318 #2319, plus #2325 #2327 #2329 #2332 #2333.

Operator spec fixes: #2301 (name test doubles in an interface-widening spec), #2321 (move a wrapped `(Manual)` marker to the criterion's first line).

## Still open — two draft PRs left deliberately

Both have a complete, working implementation blocked only by one missing mutation-killing test. Abandoning them would discard that work, so they are left as **drafts** rather than closed:

- **PR #2337** `repair-commits-limited-to-run-diff-and-spec-tree` — five attempts (one
  `role_stalled`, then `surviving_mutation_failed` repeatedly). Site:
  `v2/src/execution/ready-gate-repair-fence.ts:37`, `prefix === undefined` in
  `resolveRepairSpecScope`. Kill it with a case driving a **directory** spec path to the
  `descendants` scope. Blocks three queued gate-repair intents.
- **PR #2334** `list-row-step-honesty` — cleared its gate after a hand fix (below); now blocked at
  `v2/src/daemon/daemon.ts:884`, `progress.status === "in_progress"` in `reportReviewProgress`. Kill
  it by asserting a terminal review progress gets `attemptCount` coerced to ≥ 1 while an
  `in_progress` one is stored unchanged.

Also unimplemented: `20260730T043002Z-exhausted-red-ready-gate-settles-failed-and-resumable` (planned #2296) and slice 5's remaining two intents.

## Cost

Agent-side (telemetry, 412 role invocations): **$12.53**. cursor 220 invocations (subscription, $0.00 recorded), codex 188 (`gpt-5.6-sol` 141, `gpt-5.6-terra` 47), claude 4. Exit kinds: 332 `ok`, 72 `quota`, 7 `stall`, 1 `error`. Operator `/cost` requested separately.

The 72 `quota` exits are codex escalations during the codex-first window; they did not stop work — the flat agent list escalated and the runs completed.

## What the fan-out taught us

Peak was **8 concurrent lanes** (5 implement + 3 plan/intent), load average 15–25. That is past this machine's comfortable point:

- Three runs settled `idle_output_timeout` at peak load, all of which recovered on re-dispatch at
  lower load. Read a cluster of these as saturation, not as an agent verdict.
- Two specs that both touched `state-store.ts` collided on migration id `015` and on a hardcoded
  `migrationCount.total`; the second cost a hand merge-conflict resolution.
- Fanning out a dependency chain wastes one dispatch per unmet edge — five plan runs correctly
  refused with `## Blocker` naming an unmerged sibling.

Plans and intents parallelize cleanly (each ~5 min, none contended). The throttle belongs on implement runs, at about 3–4 on this machine.

## Hand interventions (each one a harness gap)

Seven, all recorded above or seeded:

1. `bun run fix` + `jarvis run resume` on five formatter-only red gates.
2. One `noExcessiveCognitiveComplexity` extraction in `pipeline-execution.ts` that repair could not
   do (genuine agent work the budget never reached).
3. Three merge-conflict resolutions between concurrently-implemented specs (including a migration-id
   collision and a hardcoded migration count).
4. Two spec edits to unblock refusing runs (#2301 test doubles, #2321 `(Manual)` marker).
5. One stale test assertion updated by hand (`daemon.sandbox-unrunnable.test.ts` gained
   `finishedAtMs`) — the run could not fix it because the out-of-scope classifier called its own
   breakage untouched.
6. One mutation-killing test written by hand for `isReopenedFailedContinuation` (verified by
   applying the mutation: 1 fail, then restoring: 52 pass), unblocking #2336.
7. One manual acceptance criterion verified by hand before ticking (collapse dedup mutation → 3 of
   5 cases red, restore → 5 pass).

## Seeds written

| Seed | Trigger |
| --- | --- |
| `out-of-scope-gate-classification-strands-caused-failures` | #2313's new classifier called a run-caused failure "out of scope" and advertised a resume that could not help — three identical resumes |
| `mutation-verification-artifact-reached-the-completion-commit` | PR #2314 shipped an inverted guard inside its completion commit; local gate green, 26 v1 tests red in CI |
| `gate-repair-does-not-run-the-formatter` | Two formatter-only red gates exhausted the repair budget; `bun run fix` + resume fixed both |
| `guard-inversion-criteria-produce-production-test-flags` | #2323 added one `setInvert*ForTest`, #2328 added four — while #2326 existed to delete one |
| `human-only-marker-read-from-first-line-only` | A wrapped `(Manual)` criterion blocked two implement dispatches |

Runbook updated with seven gotchas from this session (see `v2/docs/operator-runbook.md` § Known gotchas, 2026-07-30 entries).

## Friction not seeded (one-offs)

- Three plan/implement runs settled `contract_miss` on `artifact.exists` or `spec.criteria-ticked`
  under cursor; each cleared on re-dispatch.
- `jarvis run list --branch` is the only reliable handle on a workflow — entry run ids settle while
  the workflow continues, exactly as the runbook says.
- `gh pr merge --admin` silently no-ops on a draft PR; `gh pr ready` first. Two implement runs left
  a ready-flip undone despite a green gate and fully ticked criteria (#2303, #2310).
- `gh` needs `dangerouslyDisableSandbox` in this session (TLS verification fails in the sandbox), and
  `jarvis daemon status` false-negatives there too.
