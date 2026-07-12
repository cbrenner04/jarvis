# Operator report — v1 sizing seed + regression + v2 seeds 05–09

UTC 2026-07-11. Operator: Claude Code (Opus 4.8, 1M). Agent order started
`codex → claude → cursor → opencode`; codex depleted mid-session (removed, then
re-added on reset, then depleted again). Cursor (Composer 2.5) became the reliable
impl actuator once codex was out — separate pool from the operator's Claude
session, so no pool contention.

## What shipped (34 PRs merged; 3 failed PRs closed)

**v1 seed `plan-subspec-one-iteration-sizing`** (both split intents):

- `plan-one-iteration-subspec-drafting` — draft/review prompt sizing + `validateSplitIntegrity` (#1325)
- `plan-resplit-timed-out-subspec` — `jarvis1 plan --recover` timed-out-subspec recovery; removed the manual subspec-split runbook stopgap (#1330)

**Self-inflicted regression, fixed** — #1325 gated split-integrity on the verdict
text matching `/\bsplit\b/i`, so any plan whose review verdict merely mentioned
"split" aborted (`agent-error`). Killed both seed-06 plans. Seeded (#1333),
fixed via intent→plan(`--review-passes 0`)→run (#1334/#1335/#1336): gate on an
actual structural split; no-split returns null.

**v2 seed 05 `implement-spec-routing`** — 3 specs: linked-subspec routing (#1337),
optional preset review slot (#1338), spec-path launch resolution (#1339).

**v2 seed 06 `workflow-loader-non-write`** — 2 specs: load `review-debate` steps
(#1345), load `review` steps + route reviewed-intent (#1347).

**v2 seed 07 `plan-reviewed-light`** — plan (#1350) + impl (#1353): `review`
critic prompt + light plan-review workflow.

**v2 seed 08 `plan-reviewed-debate`** — plan (#1348) + impl (#1352): `plan-reviewed`
debate preset (review caught a real git-disabled `cwd` bug).

**v2 seed 09 `implement-review-selection`** — optional debate review (#1354) +
light review selection (#1357).

**User-directed revert** (#1349) — the operator judged the one-iteration-sizing
review enforcement (`validateSplitIntegrity`) more trouble than value: it never
achieved its aim (specs drafted for it were still monoliths) and its strict
"preserve exactly once" check aborted plans when the actuator reworded during a
split. Removed the enforcement check + tests; kept the advisory prompts and
`--recover`. Owner confirmed review overall stays (the `review` behavior is
needed — the only other review path is full debate).

**Close-out seeds** (#1356): hermetic-tests-re-machine-config,
completion-ready-gate-rides-watchdog, plan-subspec-overbuild-still-open.

## Observations / harness friction

- **Completion ready gate rides the 10-min watchdog.** 4 of the patch runs'
  completion gates hit `watchdog-iteration-timeout` (vs 12 clean `completed-spec`);
  each recovered via shrink→review→final-ready. Seeded.
- **CI-only non-hermetic test failure.** A new loader test read the runner's
  ambient `~/.jarvis/config.json` (no `machineProfile` in CI) and failed only in
  CI; recovered with `jarvis1 review-feedback`. Seeded.
- **Shared-pool contention is acute with codex out.** With codex depleted, patch
  primary falls to claude-haiku, which competes with the operator's own Claude
  session and stalled to iteration-timeout (zero output). Fix that unblocked it:
  `jarvis1 run --agent cursor:"Composer 2.5"` — cursor is a separate pool.
- **6.5-day orphaned stray.** A reparented (`ppid 1`) `bun test` from a prior
  session pinned a core since Jul 4, causing early gate timeouts under contention.
  Killed it (single-operator machine, abandoned junk).
- **Plan split fragility** (the reverted feature) is captured in
  `plan-subspec-overbuild-still-open` — over-build remains open; do not
  re-attempt hard split-enforcement.

## Cost

Jarvis per-run cost is **not persisted in this repo's `runs.jsonl`** (no cost
field; only telemetry). Figures below are from observed run summaries; several
impl runs ran on **cursor (≈free, subscription)** and are not itemized.

Observed Jarvis spend (subset, USD): drafting impl 3.41, resplit impl 5.61,
linked-subspec impl 2.56, debate-steps plan 2.98, plan drafts 0.67–1.11, fix
plan 0.85, seed-08 wasted plan 1.09. Paid-tier (codex/claude) Jarvis subtotal is
roughly **$35–45**; cursor impl runs add negligible metered cost.

**Operator (this Claude Code session) cost: run `/cost` to fill** — not
self-measurable by the agent. This orchestration loop dominates session spend
(long session, many poll/merge turns).

Full 4-CSV reconciliation deferred — cost source gap (no per-run cost in
`runs.jsonl`) makes exact per-spec attribution unreliable this session; see the
seeded gaps and this markdown for the durable record.
