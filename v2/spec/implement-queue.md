# v2 implement queue

Authority: operator priorities. Rebuilt 2026-07-27 after the recovery batch shipped.

## Rule

Recovery batch is done. The implement lane runs **per-project pipelines** until that phase ships.
Everything else is a parallel plan/intent lane.

## Recovery batch — shipped

| # | Work | PR |
| --- | --- | --- |
| 1 | write-loop iteration durability floor | #2236 |
| 2 | resume a durable review row through its mutation tail | #2233 |
| 3 | implement repairs a ticked run with a surviving mutation | in flight |

Also shipped this session: review roles honor the configured idle budget (#2230), `run log` snapshots
live runs (#2238), husk at managed path no longer strands re-dispatch (#2228).

## Phase gate — per-project pipelines

The [brief](per-project-pipelines-brief.md) is **not** plan input: its slices are seeded individually
(`seeds/pipeline-*.md`) and fanned out through `intent` → `plan` → `implement`.

| Slice | Work | State |
| --- | --- | --- |
| 1a | definitions, registry, admission validation | shipped #2240 |
| 1b | project config selects a pipeline | shipped #2248 |
| 2a | durable pipeline + stage records | shipped #2249 |
| 2b | daemon-ordered stage execution | planning |
| 2c | restart reconciliation | planned #2250 |
| 3 | approve/reject + resume | seeded |
| 4 | CLI start/list/wait/detach | seeded |
| 5 | configured terminal actions | seeded |
| 6 | one e2e integration proof | seeded |

**Slot before slices 3–6:** `seeds/intent-splits-by-surface.md` and
`seeds/plan-splits-an-oversized-subspec.md`. Slices 3–6 are the next work to go through `intent` and
`plan`, so split discipline pays there first. Evidence: every subspec at this session's norm landed on
its first implement; the one oversized spec cost two failed runs.

**Slot before 2b:** `seeds/pipeline-posture-table-rejects-a-realizable-cell.md`. #2240's validator
rejects `intent` + `debate`, which the CLI supports. Inert only while nothing resolves a posture —
2b is what starts resolving them, so this ships first or with it.

Plan-lane dependency: each slice's plan blocks until its prerequisite slice is **implemented**, not
merely planned. Observed twice (1b, 2b) — both agents correctly refused with a `## Blocker`.

## Ready-intents (queued)

| File | Notes |
| --- | --- |
| `ready-intents/aggregate-timeout-reaps-the-test-process-group.md` | Insert only if a hung descendant is observed |
| `ready-intents/guard-bare-settimeout-in-deterministic-tests.md` | Low; prereqs satisfied |
| `ready-intents/split-v2-review-prompt-ids-from-v1.md` | Prereq to later review work only |

## Seeds — reliability, filed this session

| Seed | Notes |
| --- | --- |
| `seeds/gate-repair-edits-unrelated-tests-to-go-green.md` | Seen twice; one instance weakened a v1 test, one hit an intent workflow |
| `seeds/terminal-settle-leaves-agent-and-lock-behind.md` | Mid-repair rows read `completed`; agent + lock outlived the settle |

## Seeds (deferred / low)

Notable: `daemon-child-output-test-races-process-startup` (mitigated #2208, race remains),
`publication-tails-are-consolidated`, `materialization-base-drift-guard`,
`cleanup-prunes-merged-dead-branches`, `implement-review-bounds-diff-payload`,
`review-checkpoint-reuse-is-not-scoped-to-a-dispatch`, `set-agents-accepts-any-string-including-flags`,
`reviewer-verification-command`, `surface-the-completion-commit-error-instead-of-swallowing-it`,
`archival-refusal-names-why-owner-was-not-retired` (ship with next cleanup diagnostic touch).

TUI presentation work is folded into [tui-overhaul-brief.md](tui-overhaul-brief.md);
`seeds/tui-monitor-row-honesty.md` may land before the full TUI phase.
