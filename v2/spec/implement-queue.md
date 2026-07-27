# v2 implement queue

Authority: operator priorities. Rebuilt 2026-07-27 at session close.

## Rule

Recovery batch and pipeline slices 1–2 are done. The implement lane stays on **per-project
pipelines** (slices 3–6) until that phase ships. Reliability seeds are a parallel lane, except the P0.

## P0 — fix before anything else

| Seed | Why |
| --- | --- |
| `seeds/intent-review-boundary-drops-a-path-character.md` | A whole-output `trim()` shifts porcelain parsing by one character, so every git-enabled `intent` review reports a false boundary violation and lands nothing. Seven for seven on 2026-07-27. Workaround: `--review-passes 0`. |
| `seeds/absent-pipeline-config-blocks-every-implement.md` | #2248 made an absent `projects.<key>.pipeline` refuse **every** implement dispatch. The lane only runs because that key was hand-added to `~/.jarvis/config.json`; it can be removed once this ships. |

## Phase gate — per-project pipelines

The [brief](per-project-pipelines-brief.md) is **not** plan input: its slices are seeded individually
(`seeds/pipeline-*.md`) and fanned out through `intent` → `plan` → `implement`.

| Slice | Work | State |
| --- | --- | --- |
| 1a | definitions, registry, admission validation | shipped #2240 |
| 1b | project config selects a pipeline | shipped #2248 |
| 2a | durable pipeline + stage records | shipped #2249 |
| 2b | daemon-owned ordered stage execution | shipped #2255 |
| 2c | restart reconciliation | shipped #2254 |
| 3 | approve/reject + resume | seeded |
| 4 | CLI start/list/wait/detach | seeded |
| 5 | configured terminal actions | seeded |
| 6 | one e2e integration proof | seeded |

**Slot before slice 3:** `seeds/intent-splits-by-surface.md` and
`seeds/plan-splits-an-oversized-subspec.md`. Slices 3–6 are the next work through `intent` and
`plan`, so split discipline pays there first.

**Slot before any work that resolves a posture:**
`seeds/pipeline-posture-table-rejects-a-realizable-cell.md`. #2240's validator rejects `intent` +
`debate`, which the CLI supports.

Plan-lane dependency: each slice's plan blocks until its prerequisite slice is **implemented**, not
merely planned. Observed twice (1b, 2b) — both agents correctly refused with a `## Blocker`.

## Reliability seeds — parallel lane

| Seed | Notes |
| --- | --- |
| `seeds/gate-repair-edits-unrelated-tests-to-go-green.md` | Seen twice; one weakened a v1 test, one hit an intent workflow and committed harness sidecars |
| `seeds/terminal-settle-leaves-agent-and-lock-behind.md` | Mid-repair rows read `completed`; an agent and its worktree lock outlived the settle |
| `seeds/cleanup-aborts-on-a-missing-keyed-socket.md` | A rebuilt executable moves the socket key; cleanup dies on a raw `ENOENT` and skips daemon-independent work |

## Ready-intents (queued)

| File | Notes |
| --- | --- |
| `ready-intents/aggregate-timeout-reaps-the-test-process-group.md` | Insert only if a hung descendant is observed |
| `ready-intents/guard-bare-settimeout-in-deterministic-tests.md` | Low; prereqs satisfied |
| `ready-intents/split-v2-review-prompt-ids-from-v1.md` | Prereq to later review work only |

## Seeds (deferred / low)

Notable: `daemon-child-output-test-races-process-startup` (mitigated #2208, race remains),
`publication-tails-are-consolidated`, `materialization-base-drift-guard`,
`cleanup-prunes-merged-dead-branches`, `implement-review-bounds-diff-payload`,
`review-checkpoint-reuse-is-not-scoped-to-a-dispatch`, `set-agents-accepts-any-string-including-flags`,
`reviewer-verification-command`, `surface-the-completion-commit-error-instead-of-swallowing-it`,
`archival-refusal-names-why-owner-was-not-retired` (ship with next cleanup diagnostic touch).

TUI presentation work is folded into [tui-overhaul-brief.md](tui-overhaul-brief.md);
`seeds/tui-monitor-row-honesty.md` may land before the full TUI phase.
