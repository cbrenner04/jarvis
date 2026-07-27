# v2 implement queue

Authority: operator priorities in `.scratch/2026-07-27-next-v2-priorities.md` (rebuilt when the lane shifts). Counts below are the spec tree after cleanup on 2026-07-27.

## Rule

Reliability floor is done. The implement lane runs the **recovery batch** once, then **per-project pipelines** until that phase ships. P1 items are a parallel plan/intent lane — not a second reliability tier.

## P0 — recovery batch (serialize 1 → 2 → 3)

| Order | Seed | Notes |
| --- | --- | --- |
| 1 | `ready-intents/write-loop-iteration-durability-floor.md` | Work loss; verification must observe a killed run |
| 2 | `seeds/resume-refuses-the-review-row-it-advertises.md` | Three surfaces must agree on resumability |
| 3 | `seeds/ticked-criteria-plus-mutation-failure-is-unrecoverable.md` | Depends on 2; needs a forward path without unticking criteria |

## P1 — parallel, not blocking pipelines

| Seed / ready-intent | Notes |
| --- | --- |
| `seeds/review-roles-ignore-the-configured-idle-budget.md` | Config lever silently ignored on review steps |
| `seeds/run-log-blocks-on-live-runs.md` | `run log` unusable when needed most |
| `ready-intents/husk-at-managed-path-does-not-strand-redispatch.md` | Husks observed again; cleanup cannot retire them |

## Phase gate

After the recovery batch, implement lane stays on [per-project pipelines](per-project-pipelines-brief.md) until merged `v2/src` satisfies the meta-index line. The brief is **not** plan input: its six slices are seeded individually (`seeds/pipeline-*.md`) and fanned out through `intent` → `plan` → `implement`, serialized 1 → 2 → {3, 4} → 5 → 6.

## Ready-intents (queued)

| File | Notes |
| --- | --- |
| `ready-intents/aggregate-timeout-reaps-the-test-process-group.md` | Unblocked since #2190; insert only if a hung descendant is observed |
| `ready-intents/guard-bare-settimeout-in-deterministic-tests.md` | Low; prereqs satisfied |
| `ready-intents/split-v2-review-prompt-ids-from-v1.md` | Prereq to later review work only |

## Seeds (deferred / low)

See the fold table in `.scratch/2026-07-27-next-v2-priorities.md`. Notable: `daemon-child-output-test-races-process-startup` (mitigated #2208, race remains), `publication-tails-are-consolidated`, `materialization-base-drift-guard`, `cleanup-prunes-merged-dead-branches`, `implement-review-bounds-diff-payload`, `review-checkpoint-reuse-is-not-scoped-to-a-dispatch`, `set-agents-accepts-any-string-including-flags`, `reviewer-verification-command`, `surface-the-completion-commit-error-instead-of-swallowing-it`, `seeds/archival-refusal-names-why-owner-was-not-retired.md` (ship with next cleanup diagnostic touch).

TUI presentation work is folded into [tui-overhaul-brief.md](tui-overhaul-brief.md); `seeds/tui-monitor-row-honesty.md` may land before the full TUI phase.
