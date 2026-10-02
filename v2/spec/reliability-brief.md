# Harness reliability brief

Reviewed 2026-10-02 against `main` after the [2026-10-01/02 session](../../reports/20261002T055400Z-operator-reliability-backlog.md). Scope: active `v2/spec/` files, excluding `completed/`. [Ledger](./reliability-ledger.md) owns the item inventory, dependencies, and review caveats. Historical evidence stays in git and `reports/`.

## Structural recovery is closed

The August 29 charter's five retirements are complete. This is a separate, bounded reliability backlog; later defects and feature requests do not reopen that charter. CLI retirement is an unfinished original side item, parked pending the `run pause` decision.

## Current inventory

There are **5 active spec plans, 2 ready-intents, and 22 seeds** (2026-10-02: #4428–#4432, #4436 merged). Seeds still require intent/plan review; a priority here does not make a seed an executable spec.

| Queue | Active specs | Ready-intents | Seeds | Treatment |
| --- | --- | --- | --- | --- |
| Highest priority | 1 | 0 | 0 | Linked resume: terminal evidence (in flight) |
| Immediate reliability | 4 | 1 | 3 | Bounded completion target below |
| Follow-on workflow quality | 0 | 0 | 7 | Separate prioritization after the immediate queue |
| Operator features and ergonomics | 0 | 0 | 3 | Useful additions, outside the completion target |
| Parked design and cleanup | 0 | 0 | 6 | Preserve decisions and dependencies; no automatic dispatch |
| Parked owner seeds (outside target) | 0 | 0 | 3 | #4419 — not in the backlog |
| Evidence-gated investigation | 0 | 1 | 0 | WAL failure capture required |

## Immediate reliability target

Write-loop test split (#4431), agent process ownership (#4428, #4436), and original workstreams 2 (mutation), 4 (lane-PR settlement), 5 (notification handoff), 6 (plan-shape recovery), and 7 (fan-out terminal settlement) are **done** (2026-10-01/02). What remains:

| Order | Workstream | Done when |
| --- | --- | --- |
| 0 | Linked resume terminal evidence (1 spec, in flight) | "Finished" incident waits for all rows. Admitted-row settlement (#4429), published-lane recovery (#4430), retiring-owner force kill (#4432) merged. |
| 1 | Finalization gates share the gate slot (in flight) | Harness gates wait on the per-daemon slot; concurrent publication no longer false-reds. |
| 2 | Ready-repair direction (2 active specs) | Repair prompt lists allowed paths; `ready_gate_repair` logs failing step + output tail. |
| 3 | Agent history-rewrite guard (active spec + ready-intent) | Iterations revert agent rebases/resets; implement rules forbid history mutation. |
| 4 | Hung killing test kills the mutant (seed) | A test hanging under a mutant counts as killed; no `non_terminating_mutation_failed` strand. |

This target closes when these workstreams are implemented, reviewed, merged, and their queue files removed, or explicitly retired with evidence.

## Execution order and boundaries

- Linked resume: only terminal evidence remains. Resuming an all-ticked `~link-N` row is now safe.
- Workstreams 1–3 all touch `write-loop.ts`/its tests: implement them serially in the order above, each against the preceding merge. Plans may fan out.
- Expect agents to respect the 2-run gate budget (#4407) on new dispatches; lanes started earlier still loop.
- Until workstream 1 lands, keep concurrent finalization gates to ~2 and resume failed gates one at a time.
- WAL work requires a real captured rejection. Harness-owned agent tools require explicit owner sign-off. Decide whether `run pause` survives before planning CLI retirement or dock grammar.

## Maintenance

Keep one ledger row per active spec, seed, or ready-intent; replace consumed rows with their active plan when one lands. Remove completed rows after verifying implementation on `main`; record session history in `reports/`. Recount the queue after each closeout.

Use [operator practices](../docs/operator-practices.md) for worktrees, review, merging, and session discipline; the [runbook](../docs/operator-runbook.md) owns recovery and gate procedures.
