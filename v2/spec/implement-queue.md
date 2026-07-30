# v2 implement queue

Authority: operator priorities. Rebuilt 2026-07-29.

## Rule

The implement lane stays on **per-project pipelines** (slices 3–6) until that phase ships.
Reliability and split-discipline intents are a parallel lane.

Both 2026-07-27 P0s shipped: boundary path parsing (#2273, confirmed by live intent
reviews #2275/#2283/#2284 — `--review-passes 0` bypass no longer needed) and absent-pipeline admission
(#2274 — the hand-added `projects.jarvis.pipeline` key in `~/.jarvis/config.json` is no longer a
required workaround; keep it only if the `full-review` pipeline is wanted). Opencode landed
off-queue (#2280 invocable, #2282 quota classification).

## In flight — planned, awaiting implement

| Spec | Notes |
| --- | --- |
| `20260727T203910Z-plan-emits-one-subspec-per-module-boundary/` | 5 subspecs (#2272). Implement before slice 3 — split discipline pays there first |
| `20260727T203910Z-cleanup-without-listening-daemon/` | 1 subspec |

## Phase gate — per-project pipelines

The [brief](per-project-pipelines-brief.md) is **not** plan input: its slices are seeded
individually (`seeds/pipeline-*.md`) and fanned out through `intent` → `plan` → `implement`.

| Slice | Work | State |
| --- | --- | --- |
| 1a–2c | definitions/registry/validation, config selection, durable records, daemon-ordered execution, restart reconciliation | shipped #2240 #2248 #2249 #2255 #2254 |
| 3 | approve/reject + resume | seeded |
| 4 | CLI start/list/wait/detach | seeded |
| 5 | configured terminal actions | seeded |
| 6 | one e2e integration proof | seeded |

**Slot before slice 3** (with the in-flight plan-emits spec above):
`ready-intents/intent-split-multi-surface-regression.md`,
`ready-intents/plan-blocks-unmet-split-dependencies.md`,
`ready-intents/plan-split-index-orders-by-dependency.md`,
`ready-intents/plan-split-preserves-draft-scope.md`.
`intent-split-prompt-by-surface` shipped #2277.

**Slot before any work that resolves a posture:**
`ready-intents/pipeline-posture-table-pins-cli-review-acceptance.md`. The `intent` + `debate`
rejection is fixed (#2276); the table pin is still open.

Plan-lane dependency: each slice's plan blocks until its prerequisite slice is **implemented**, not
merely planned. Observed twice (1b, 2b) — both agents correctly refused with a `## Blocker`.

## Reliability lane

| Intents | Notes |
| --- | --- |
| `ready-intents/markdown-only-workflow-ready-repair-rejects-code-edits.md`, `ready-gate-red-in-untouched-files-is-out-of-scope.md`, `ready-gate-repair-cannot-extend-load-sensitive-files.md`, `ready-gate-repair-omits-jarvis-sidecars-from-commits.md`, `repair-commits-limited-to-run-diff-and-spec-tree.md` | Gate repair edits unrelated tests to go green; seen twice |
| `ready-intents/terminal-settle-cancels-repair-agent-and-releases-lock.md`, `exhausted-red-ready-gate-settles-failed-and-resumable.md` | Fan-out of the terminal-settle seed (#2275): stray agent + held lock; red gate settling `completed` |
| `ready-intents/cleanup-eligibility-uses-live-socket-discovery.md`, `cleanup-prunes-merged-dead-branches.md` (#2284) | With the planned cleanup spec above: rebuilt executable moves the socket key; merged-branch ref pruning |

## TUI honesty fan-out (#2283)

From the retired `tui-monitor-row-honesty` seed. Store/list fixes may precede the
[TUI phase](tui-overhaul-brief.md): `ready-intents/list-row-step-honesty.md`,
`store-timestamps-terminal-reconciliation.md`, `workflow-collapse-drops-test-flag.md`.
Chrome stays with the phase: `terminal-window-renders-finishless-rows.md`,
`expansion-driven-through-e-keybinding.md`.

## Ready-intents (queued)

| File | Notes |
| --- | --- |
| `ready-intents/aggregate-timeout-reaps-the-test-process-group.md` | Insert only if a hung descendant is observed |
| `ready-intents/guard-bare-settimeout-in-deterministic-tests.md` | Low; prereqs satisfied |
| `ready-intents/split-v2-review-prompt-ids-from-v1.md` | Prereq to later review work only |

## Seeds (deferred / low)

`daemon-child-output-test-races-process-startup` (mitigated #2208, race remains),
`publication-tails-are-consolidated`, `materialization-base-drift-guard`,
`implement-review-bounds-diff-payload`, `review-checkpoint-reuse-is-not-scoped-to-a-dispatch`,
`set-agents-accepts-any-string-including-flags`, `reviewer-verification-command`,
`surface-the-completion-commit-error-instead-of-swallowing-it`,
`archival-refusal-names-why-owner-was-not-retired` (ship with next cleanup diagnostic touch).
