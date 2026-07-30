# v2 implement queue

Authority: operator priorities. Rebuilt 2026-07-30.

## Rule

Per-project pipelines (slices 3–6) stay ahead of everything else until the phase ships. Reliability
and split-discipline intents are a parallel lane.

The 2026-07-29 phase gate is **closed**: both in-flight specs landed (#2303 plan-emits-one-subspec
and #2302 cleanup-without-listening-daemon) and all four slot-before intents shipped
(#2297, #2298, #2316, #2323). The posture table pin shipped (#2324).

## Phase gate — per-project pipelines

The [brief](per-project-pipelines-brief.md) is **not** plan input: slices are seeded individually
(`seeds/pipeline-*.md`) and fanned out through `intent` → `plan` → `implement`.

| Slice | Work | State |
| --- | --- | --- |
| 1a–2c | definitions/registry/validation, config selection, durable records, daemon-ordered execution, restart reconciliation | shipped #2240 #2248 #2249 #2255 #2254 |
| 3 | approve/reject + resume | shipped #2320 (durable state), #2330 (daemon) |
| 4 | CLI start/list/wait/detach | shipped #2304 (store enum), #2310 (daemon observe/wait), #2328 (CLI) |
| 5 | configured terminal actions | validation shipped #2336; **next**: `ready-intents/execute-pipeline-terminal-publication.md`, then `settle-pipeline-terminal-action.md` |
| 6 | one e2e integration proof | `ready-intents/pipeline-end-to-end-integration-proof.md` — plan only after slice 5 lands |

Slice-3 CLI tail shipped (#2335). `jarvis pipeline start | list | wait | approve | reject | resume`
exists; the phase is **not** usable end to end until slice 5's execution/settlement intents and the
slice-6 proof land.

Plan-lane dependency: each slice's plan blocks until its prerequisite slice is **implemented**, not
merely planned. Observed on 1b, 2b, and repeatedly on 2026-07-30 (slice-4 daemon observation,
slice-5 terminal action, `list-row-step-honesty`, `markdown-only-…`) — agents refuse correctly with
a `## Blocker`. Dispatching a dependent plan early costs one wasted run; land the prerequisite first.

## Reliability lane

| Work | State |
| --- | --- |
| Gate scope: red in untouched files is out of scope | shipped #2313 |
| Terminal settle cancels repair + releases lock | shipped #2311 |
| `cleanup` prunes merged dead branches | shipped #2315 |
| Reconciliation stamps a finish time | shipped #2322 |
| `20260730T043301Z-repair-commits-limited-to-run-diff-and-spec-tree/` | **carried over** (draft PR #2337) — five attempts (`role_stalled`, then `surviving_mutation_failed` twice at `v2/src/execution/ready-gate-repair-fence.ts:37`, `prefix === undefined`). Needs a case where a directory spec path yields `descendants` scope. Blocks the three intents below |
| `ready-intents/markdown-only-workflow-ready-repair-rejects-code-edits.md`, `ready-gate-repair-omits-jarvis-sidecars-from-commits.md`, `ready-gate-repair-cannot-extend-load-sensitive-files.md` | blocked on the fence spec above |
| `20260730T043002Z-exhausted-red-ready-gate-settles-failed-and-resumable/` | planned (#2296), not implemented |
| `ready-intents/cleanup-eligibility-uses-live-socket-discovery.md` | ready |

## TUI honesty fan-out (#2283)

`20260730T084815Z-list-row-step-honesty/` **carried over** (draft PR #2334). Its gate red is fixed —
the stale frame snapshot in `v2/src/daemon/daemon.sandbox-unrunnable.test.ts` now expects
`finishedAtMs` — but it settles `surviving_mutation_failed` at `v2/src/daemon/daemon.ts:884`
(`progress.status === "in_progress"` in `reportReviewProgress`). Kill it by asserting a terminal
review progress coerces `attemptCount` to ≥ 1 while an `in_progress` one is stored unchanged, then
resume. `workflow-collapse-drops-test-flag` shipped
(#2326). Chrome stays with the [TUI phase](tui-overhaul-brief.md):
`ready-intents/terminal-window-renders-finishless-rows.md`,
`expansion-driven-through-e-keybinding.md`.

## Ready-intents (queued)

| File | Notes |
| --- | --- |
| `ready-intents/aggregate-timeout-reaps-the-test-process-group.md` | Insert only if a hung descendant is observed |
| `ready-intents/guard-bare-settimeout-in-deterministic-tests.md` | Low; two plan dispatches settled `contract_miss` — retry or hand-draft |
| `ready-intents/split-v2-review-prompt-ids-from-v1.md` | Prereq to later review work only |

## Seeds (new 2026-07-30, ordered by cost of not fixing)

| Seed | Why |
| --- | --- |
| `out-of-scope-gate-classification-strands-caused-failures` | #2313's classifier calls a run-caused failure in an unedited file "out of scope", refuses repair, and advertises a resume that cannot help — stranded `list-row-step-honesty` over three resumes |
| `mutation-verification-artifact-reached-the-completion-commit` | A mutation shipped inside a completion commit with every local gate green; CI caught it |
| `gate-repair-does-not-run-the-formatter` | Formatter-only red gates exhaust the repair budget; hand `bun run fix` + resume is the standing stopgap |
| `guard-inversion-criteria-produce-production-test-flags` | Inversion criteria keep producing `setInvert*ForTest` in production code (#2323, #2328) |
| `human-only-marker-read-from-first-line-only` | A wrapped `(Manual)` criterion blocked two implement dispatches |

## Seeds (deferred / low)

`daemon-child-output-test-races-process-startup` (mitigated #2208, race remains),
`publication-tails-are-consolidated`, `materialization-base-drift-guard`,
`implement-review-bounds-diff-payload`, `review-checkpoint-reuse-is-not-scoped-to-a-dispatch`,
`set-agents-accepts-any-string-including-flags`, `reviewer-verification-command`,
`surface-the-completion-commit-error-instead-of-swallowing-it`,
`archival-refusal-names-why-owner-was-not-retired` (ship with next cleanup diagnostic touch).
