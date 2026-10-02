# Harness reliability brief

Reviewed 2026-10-02 (late) against `main` after the [2026-10-01/02 session](../../reports/20261002T055400Z-operator-reliability-backlog.md), the 2026-10-02 day session, and the 2026-10-02 intent-split session. Scope: active `v2/spec/` files, excluding `completed/`. [Ledger](./reliability-ledger.md) owns the item inventory, dependencies, and review caveats. Historical evidence stays in git and `reports/`.

## Structural recovery is closed

The August 29 charter's five retirements are complete. This is a separate, bounded reliability backlog; later defects and feature requests do not reopen that charter. CLI retirement is an unfinished original side item, now split into ready-intents (the `run pause` decision is made: retire).

## Current inventory

There are **0 open active spec plans, 33 ready-intents, and 0 seeds**. Every seed was split by surface into ready-intents on 2026-10-02 (#4489–#4498); the queue is now plan-ready, not executable: a ready-intent still needs `plan` and a merged spec before `implement`.

| Queue | Active specs | Ready-intents | Seeds | Treatment |
| --- | --- | --- | --- | --- |
| Immediate reliability | 0 | 0 | 0 | Target closed below |
| Operator features and ergonomics | 0 | 1 | 0 | Plan when wanted |
| Parked design and cleanup | 0 | 19 | 0 | Preserve decisions and dependencies; plan in chain order |
| Owner features (outside target) | 0 | 6 | 0 | #4419 — owner direction decides when |
| Held: owner sign-off | 0 | 6 | 0 | Toolset split; do not plan until signed off |
| Evidence-gated investigation | 0 | 1 | 0 | WAL failure capture required |

## Immediate reliability target

**Done 2026-10-01/02:** linked resume (#4429 #4430 #4432 #4440), write-loop test split (#4431), finalization gates share the gate slot (#4435), ready-repair direction (#4460 #4467), agent history-rewrite guard (#4478 #4479), agent process ownership (#4428 #4436), mutation verification (#4441 #4456 #4459), shrink failure resumable (#4465), plus original workstreams 2, 4, 5, 6 and 7.

**Closed:** All immediate workstreams merged (above + review-feedback shrink uses the lane spec, #4482; hand-implemented follow-ons #4474–#4476, #4480, #4483, #4484).

## Execution order and boundaries

- Load is the main gate-flake source: `v2/src/commands/cleanup.test.ts` runs ~69 s alone and times out under load; re-run named failures in isolation before believing a red gate.
- Plan chained intents in `(delivered by: …)` order, one at a time against the merged predecessor ([spec-guidance.md § Plan same-seam siblings serially](../docs/spec-guidance.md#plan-same-seam-siblings-serially)). Cross-split chains: tui grammar after `retire-run-pause`; `move-v2-to-top-level` after the shared fold; free-text dispatch and the toolset after `shared-git-operations-boundary`.
- WAL work requires a real captured rejection. The toolset intents require explicit owner sign-off.

## Maintenance

Keep one ledger row per active spec, seed, or ready-intent; replace consumed rows with their active plan when one lands. Remove completed rows after verifying implementation on `main`; record session history in `reports/`. Recount the queue after each closeout.

Use [operator practices](../docs/operator-practices.md) for worktrees, review, merging, and session discipline; the [runbook](../docs/operator-runbook.md) owns recovery and gate procedures.
