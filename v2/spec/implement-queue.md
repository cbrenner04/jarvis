# v2 implement queue

Authority: operator priorities. Rebuilt 2026-07-31 (overnight session).

## Start here next

1. Convert `seeds/pipeline-intent-split-fans-out-downstream-stages` — **the** blocker to unattended
   pipelines. A splitting intent is the normal outcome, and a pipeline stage carries one artifact,
   so any split dead-ends at plan. Observed on the first real `full-review` run.
2. Convert `seeds/pipeline-start-seed-path-loses-file-identity` — every `pipeline start --seed`
   produces a frontmatter-derived branch slug and never consumes the seed file.
3. Finish `20260731T005401Z-propagate-plan-draft-normalizer-reason`, then plan the blocked sibling
   `ready-intents/surface-contract-miss-reason-on-run-rows.md` (dependency chain, blocked once).
4. Convert `seeds/pipeline-config-validation-blocks-unrelated-implement` — a stale `pipeline` block
   refuses every `implement` dispatch, and every future required pipeline key repeats it.
5. Drain the two remaining gate-repair specs: `20260731T222239Z-markdown-only-workflow-ready-repair-rejects-code-edits`,
   `20260730T222243Z-ready-gate-repair-cannot-extend-load-sensitive-files`. Both planned; run them
   serially — they extend the same `validateReadyGateRepairCompletion` seam.
6. TUI chrome: `ready-intents/terminal-window-renders-finishless-rows.md`,
   `expansion-driven-through-e-keybinding.md`.

## Rule

Pipelines are the primary lane again: the mechanism ships but does not survive a real seed.
Reliability is second, TUI chrome is the parallel lane.

## Phase gate — per-project pipelines: **COMPLETE**

All six slices shipped. `jarvis pipeline start | list | wait | approve | reject | resume` is usable
end to end, and #2352 proves it composes through the daemon.

| Slice | Work | State |
| --- | --- | --- |
| 1a–2c | definitions/registry/validation, config selection, durable records, daemon-ordered execution, restart reconciliation | shipped #2240 #2248 #2249 #2255 #2254 |
| 3 | approve/reject + resume | shipped #2320, #2330, CLI tail #2335 |
| 4 | CLI start/list/wait/detach | shipped #2304, #2310, #2328 |
| 5 | configured terminal actions | shipped — validation #2336, execute #2343, settle #2348 |
| 6 | one e2e integration proof | shipped #2352 |

Operator walkthrough: [`first-workflow-walkthrough.md`](../docs/first-workflow-walkthrough.md)
§ Configured pipeline.

**Pipeline handoff: shipped** (#2359 intent records a ready-intent file, #2363 stages resolve
chained paths from the prior stage worktree). Dogfooding it immediately surfaced the next two
gaps — see Start here items 1 and 2. Until item 1 ships, a pipeline survives only a seed the
intent step does **not** split, which is the minority case.

**Before using a pipeline on this machine**, note `projects.<name>.pipeline` now requires
`terminalAction`; the jarvis entry is set to `ready`. See the seed in item 3 — until it ships,
a missing or stale key refuses unrelated `implement` dispatches too.

## Reliability lane

| Work | State |
| --- | --- |
| Gate scope: red in untouched files is out of scope | shipped #2313 |
| Terminal settle cancels repair + releases lock | shipped #2311 |
| `cleanup` prunes merged dead branches | shipped #2315 |
| Reconciliation stamps a finish time | shipped #2322 |
| Repair commits limited to run diff and spec tree | shipped #2337 |
| Exhausted red ready gate settles failed and resumable | shipped #2349 |
| `cleanup` eligibility uses live socket discovery | shipped #2347 |
| Three gate-repair intents formerly blocked on #2337 | **ready** — see Start here item 2 |

## TUI honesty fan-out (#2283)

`list-row-step-honesty` shipped (#2334); `workflow-collapse-drops-test-flag` shipped (#2326).
Remaining chrome sits with the [TUI phase](tui-overhaul-brief.md):
`ready-intents/terminal-window-renders-finishless-rows.md`,
`expansion-driven-through-e-keybinding.md`.

## Ready-intents (queued)

| File | Notes |
| --- | --- |
| `markdown-only-workflow-ready-repair-rejects-code-edits.md` | Unblocked by #2337 |
| `ready-gate-repair-omits-jarvis-sidecars-from-commits.md` | Unblocked by #2337 |
| `ready-gate-repair-cannot-extend-load-sensitive-files.md` | Unblocked by #2337 |
| `terminal-window-renders-finishless-rows.md` | TUI chrome |
| `expansion-driven-through-e-keybinding.md` | TUI chrome |
| `aggregate-timeout-reaps-the-test-process-group.md` | Insert only if a hung descendant is observed |
| `guard-bare-settimeout-in-deterministic-tests.md` | Low; **three** plan dispatches have settled `contract_miss` on it. Do not retry before the normalizer-reason seed ships — run the normalizer by hand first (see that seed) |
| `split-v2-review-prompt-ids-from-v1.md` | Prereq to later review work only |

## Seeds (ordered by cost of not fixing)

| Seed | Why |
| --- | --- |
| `pipeline-intent-split-fans-out-downstream-stages` | A splitting intent is the normal outcome and dead-ends every pipeline at plan; blocks unattended runs entirely |
| `pipeline-start-seed-path-loses-file-identity` | Frontmatter-derived branch slug, and the seed file is never consumed; hits every `pipeline start --seed` |
| `iteration-timeout-discards-completed-subspecs` | A timeout's only recovery retires the branch, discarding finished subspecs; cost a hand-finish on a 3-subspec spec |
| `pipeline-config-validation-blocks-unrelated-implement` | A stale `projects.<name>.pipeline` block refuses `implement`, which never reads pipelines |
| `out-of-scope-gate-classification-strands-caused-failures` | #2313's classifier calls a run-caused failure in an unedited file "out of scope" and advertises a resume that cannot help |
| `mutation-verification-artifact-reached-the-completion-commit` | A mutation shipped inside a completion commit with every local gate green; CI caught it |
| `gate-repair-does-not-run-the-formatter` | Formatter-only red gates exhaust the repair budget; hand `bun run fix` + resume is the standing stopgap |
| `guard-inversion-criteria-produce-production-test-flags` | Recurs as parameters too, not just exports (#2359, #2360); #2360's invert plumbing survived mutation verification and cost a hand-written regression |
| `human-only-marker-read-from-first-line-only` | A wrapped `(Manual)` criterion blocked two implement dispatches |

## Seeds (deferred / low)

`daemon-child-output-test-races-process-startup` (mitigated #2208, race remains),
`publication-tails-are-consolidated`, `materialization-base-drift-guard`,
`implement-review-bounds-diff-payload`, `review-checkpoint-reuse-is-not-scoped-to-a-dispatch`,
`set-agents-accepts-any-string-including-flags`, `reviewer-verification-command`,
`surface-the-completion-commit-error-instead-of-swallowing-it`,
`archival-refusal-names-why-owner-was-not-retired` (ship with next cleanup diagnostic touch).

## Carried operator notes

- **A large subspec can exceed the iteration ceiling.** Slice 6 ran 45 min on one iteration and
  settled `iteration_timeout` with the work substantially done but zero criteria ticked. It was
  hand-finished (#2352). Either raise `iterationTimeoutMs`/`iterationCeilingMs` in
  `config/machines/home.json` for that class of spec, or split the subspec at plan time. Watch for
  this on any spec pairing a large integration test with doc updates.
- **`bun test` does not typecheck.** Slice 6's tests passed green while `tsc` had two real errors.
  When hand-finishing anything, run `bun run check` and `bun run typecheck`, not just the tests.
- **A left-over worktree is not this session's.**
  `~/.jarvis/worktrees/jarvis/20260727T203911Z-intent-split-prompt-by-surface` holds modified and
  untracked files and refuses bulk retirement; it predates 2026-07-30 evening. Inspect before
  forcing.
