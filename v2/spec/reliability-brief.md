# Harness reliability brief

Reviewed 2026-10-02 (evening) against `main` after the [2026-10-01/02 session](../../reports/20261002T055400Z-operator-reliability-backlog.md) and the 2026-10-02 day session. Scope: active `v2/spec/` files, excluding `completed/`. [Ledger](./reliability-ledger.md) owns the item inventory, dependencies, and review caveats. Historical evidence stays in git and `reports/`.

## Structural recovery is closed

The August 29 charter's five retirements are complete. This is a separate, bounded reliability backlog; later defects and feature requests do not reopen that charter. CLI retirement is an unfinished original side item, parked (the `run pause` decision is made: retire).

## Current inventory

There are **0 open active spec plans, 1 ready-intent, and 11 seeds**. Nine merged spec dirs and seven consumed ready-intents still sit in `v2/spec/` until the next `jarvis cleanup` archives and prunes them (#4469 now publishes that archive PR itself). Seeds still require intent/plan review; a priority here does not make a seed an executable spec.

| Queue | Active specs | Ready-intents | Seeds | Treatment |
| --- | --- | --- | --- | --- |
| Immediate reliability | 0 | 0 | 1 | Bounded completion target below |
| Follow-on workflow quality | 0 | 0 | 0 | Separate prioritization after the immediate queue |
| Operator features and ergonomics | 0 | 0 | 1 | Useful additions, outside the completion target |
| Parked design and cleanup | 0 | 0 | 6 | Preserve decisions and dependencies; no automatic dispatch |
| Parked owner seeds (outside target) | 0 | 0 | 3 | #4419 — not in the backlog |
| Evidence-gated investigation | 0 | 1 | 0 | WAL failure capture required |

## Immediate reliability target

**Done 2026-10-01/02:** linked resume (#4429 #4430 #4432 #4440), write-loop test split (#4431), finalization gates share the gate slot (#4435), ready-repair direction (#4460 #4467), agent history-rewrite guard (#4478 #4479), agent process ownership (#4428 #4436), mutation verification (#4441 #4456 #4459), shrink failure resumable (#4465), plus original workstreams 2, 4, 5, 6 and 7. What remains:

| Order | Workstream | Done when |
| --- | --- | --- |
| 0 | Review-feedback shrink uses the lane spec (seed) | `review-feedback~shrink` gets the lane's entry spec; rounds publish their fix without a hand push. |

This target closes when that workstream is implemented, reviewed and merged, or explicitly retired with evidence.

## Execution order and boundaries

- Until workstream 0 lands, a `review-feedback` round's fix stays local: force-kill the failed `review-feedback~shrink` row and push the write commit by hand.
- Load is the main gate-flake source: `v2/src/commands/cleanup.test.ts` runs ~69 s alone and times out under load; re-run named failures in isolation before believing a red gate.
- WAL work requires a real captured rejection. Harness-owned agent tools require explicit owner sign-off. `run pause` retires (owner decision 2026-10-02); CLI retirement and dock grammar are unblocked but remain parked.

## Maintenance

Keep one ledger row per active spec, seed, or ready-intent; replace consumed rows with their active plan when one lands. Remove completed rows after verifying implementation on `main`; record session history in `reports/`. Recount the queue after each closeout.

Use [operator practices](../docs/operator-practices.md) for worktrees, review, merging, and session discipline; the [runbook](../docs/operator-runbook.md) owns recovery and gate procedures.
