# Harness reliability brief

Reviewed 2026-10-02 against `main` after the [2026-10-01/02 session](../../reports/20261002T055400Z-operator-reliability-backlog.md). Scope: active `v2/spec/` files, excluding `completed/`. [Ledger](./reliability-ledger.md) owns the item inventory, dependencies, and review caveats. Historical evidence stays in git and `reports/`.

## Structural recovery is closed

The August 29 charter's five retirements are complete. This is a separate, bounded reliability backlog; later defects and feature requests do not reopen that charter. CLI retirement is an unfinished original side item, parked pending the `run pause` decision.

## Current inventory

There are **10 active spec plans, 3 ready-intents, and 17 seeds**. Seeds still require intent/plan review; a priority here does not make a seed an executable spec.

| Queue | Active specs | Ready-intents | Seeds | Treatment |
| --- | --- | --- | --- | --- |
| Highest priority | 4 | 0 | 0 | Linked resume behaviors — do first |
| Immediate reliability | 6 | 2 | 0 | Bounded completion target below |
| Follow-on workflow quality | 0 | 0 | 5 | Separate prioritization after the immediate queue |
| Operator features and ergonomics | 0 | 0 | 3 | Useful additions, outside the completion target |
| Parked design and cleanup | 0 | 0 | 6 | Preserve decisions and dependencies; no automatic dispatch |
| Parked owner seeds (outside target) | 0 | 0 | 3 | #4419 — not in the backlog |
| Evidence-gated investigation | 0 | 1 | 0 | WAL failure capture required |

## Immediate reliability target

Original workstreams 2 (mutation), 4 (lane-PR settlement), 5 (notification handoff), 6 (plan-shape recovery), and 7 (fan-out terminal settlement) are **done** (2026-10-01/02). What remains:

| Order | Workstream | Done when |
| --- | --- | --- |
| 0 | Linked resume settles its row (4 behavior specs) | Resuming a `~link-N` row never strands it; recovery never respawns implement on a landed lane; `kill --force` reaches retiring-owner rows; "finished" incident waits for all rows. |
| 1 | Write-loop test split (in flight) | Split preserves every test and meets per-file caps; removes the slow-killer `non_terminating_mutation_failed` class. |
| 2 | Finalization gates share the gate slot (active spec, 00 partial) | Harness gates wait on the per-daemon slot; concurrent publication no longer false-reds. |
| 3 | Ready-repair direction (2 active specs) | Repair prompt lists allowed paths; `ready_gate_repair` logs failing step + output tail. |
| 4 | Agent history-rewrite guard (active spec + ready-intent) | Iterations revert agent rebases/resets; implement rules forbid history mutation. |
| 5 | Agent process ownership (active spec + ready-intent) | Implement runs record agent/descendant groups; dead-owner sweep reaches them. |

This target closes when these workstreams are implemented, reviewed, merged, and their queue files removed, or explicitly retired with evidence.

## Execution order and boundaries

- Do the linked-resume behaviors first: until it lands, never `run resume` an all-ticked `implement~link-N` row (publish by hand instead); resuming a row with unticked work is safe.
- Workstreams 1–4 all touch `write-loop.ts`/its tests: implement them serially in the order above, each against the preceding merge. Plans may fan out.
- Expect agents to respect the 2-run gate budget (#4407) on new dispatches; lanes started earlier still loop.
- Until workstream 2 lands, keep concurrent finalization gates to ~2 and resume failed gates one at a time.
- WAL work requires a real captured rejection. Harness-owned agent tools require explicit owner sign-off. Decide whether `run pause` survives before planning CLI retirement or dock grammar.

## Maintenance

Keep one ledger row per active spec, seed, or ready-intent; replace consumed rows with their active plan when one lands. Remove completed rows after verifying implementation on `main`; record session history in `reports/`. Recount the queue after each closeout.

Use [operator practices](../docs/operator-practices.md) for worktrees, review, merging, and session discipline; the [runbook](../docs/operator-runbook.md) owns recovery and gate procedures.
