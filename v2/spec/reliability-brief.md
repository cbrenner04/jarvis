# Harness reliability brief

Reviewed 2026-10-01 against `main` at `31b71a376`, after the session closeout. Scope: active `v2/spec/` files, excluding `completed/`; current source and merged history checked for the immediate queue. [Ledger](./reliability-ledger.md) owns the item inventory, dependencies, and review caveats. Historical evidence stays in git and `reports/`.

## Structural recovery is closed

The August 29 charter retired duplicated dispatch, copied pipeline settlement, non-atomic terminal writes, oversized runner/daemon modules, and weak dead-export/test-seam enforcement. Those five retirements are complete. This is a new, bounded reliability backlog; later defects and feature requests do not reopen that charter. CLI retirement is an unfinished original side item, parked pending the `run pause` decision.

The latest session also landed commit run-scope protection (#4350), the TUI supervisor (#4349), failed-settlement usage recovery (#4323), publication-time mutation repair (#4330), attributable repair scope (#4328), superseded-branch cleanup (#4329), and operator-merged terminal publication (#4322). Their prior active plans are gone. Lane-PR history, agent descendant reaping, plan-shape diagnostics, and the shared inventory locator landed foundations; their remaining consumers are tracked below.

## Current inventory

There are **0 active spec plans, 12 ready-intents, and 17 seeds**. Of the ready-intents, six have their prerequisites available for planning, five wait on other queued work, and one requires failure evidence. Seeds still require intent/plan review; a priority here does not make a seed an executable spec.

| Queue | Ready-intents | Seeds | Treatment |
| --- | --- | --- | --- |
| Immediate reliability | 10 | 4 | Bounded completion target below |
| Follow-on workflow quality | 0 | 5 | Separate prioritization after the immediate queue |
| Operator features and ergonomics | 1 | 2 | Useful additions, outside the reliability completion target |
| Parked design and cleanup | 0 | 6 | Preserve decisions and dependencies; no automatic dispatch |
| Evidence-gated investigation | 1 | 0 | WAL failure capture required |

## Immediate reliability target

| Order | Workstream | Done when |
| --- | --- | --- |
| 1 | Test inventory binding and write-loop test split | The inventory reads the real declaration; the split preserves every test and meets its file-size criteria, with timing measured separately by the operator. |
| 2 | Mutation verification and resume | A failing killing file cancels remaining candidate work; resume verifies current HEAD before deciding whether or what to repair. |
| 3 | Agent process ownership | Implement runs record agent/descendant groups, and the existing dead-owner sweep is proven to reach them. |
| 4 | Lane-PR settlement | Closed/merged history produces the intended durable run/stage outcome, consistent list/wait/notification evidence, and an explicit resume opt-in for intentional republication. |
| 5 | Notification handoff | A waiting notification client reconnects with its cursor after daemon replacement, within a bounded retry policy. |
| 6 | Plan-shape recovery | Repairable shape failures get one useful reprompt; missing-directory failures do not; operator docs match. |
| 7 | Fan-out terminal settlement | Each lane settles publication independently; successful lanes no longer produce the blanket fan-out failure; per-lane merge and failure evidence are covered. |

This target closes when these seven workstreams are implemented, reviewed, merged, and their consumed queue files removed, or explicitly retired with evidence. Follow-on features, parked decisions, and an uncaptured WAL flake do not extend the target. New discoveries enter the ledger for separate prioritization rather than silently expanding it.

## Execution order and boundaries

- Fix the resume inventory consumer before copying its pattern into the write-loop split; use the landed shared locator contract. Finish the split before planning more edits to its test file. This is recommended sequencing, not an existing ready-intent prerequisite.
- Plan and implement same-file work serially against the preceding merge. Mutation, lane settlement, process recording, and plan reprompt work all touch the write-loop area; do not dispatch the six available ready-intents as one parallel batch.
- Within each chain, finish the head before its consumers. Fold documentation tails into the same reviewed plan when practical; do not dispatch a docs-only dependent ahead of its behavior.
- The lane-PR publication guard already exists; implement settlement and projections, not another history lookup. Abort already reaps descendant groups; add recording and verify the existing sweep, not another kill mechanism.
- Correct stale premises at plan time: the current shape guard excludes the whole shape family; the inventory regex already accepts `_`; fan-out acceptance criteria need explicit merge coverage. Details are in the ledger.
- WAL work requires a real captured rejection. Harness-owned agent tools require explicit owner sign-off. Decide whether `run pause` survives before planning CLI retirement or dock grammar.

## Maintenance

Keep one ledger row per active seed or ready-intent; replace consumed rows with their active plan when one lands. Remove completed rows after verifying implementation on `main`; record session history in `reports/`, not a growing landed/reaped appendix. Recount the queue after each closeout. Older unseeded observations require fresh evidence before becoming work.

Use [operator practices](../docs/operator-practices.md) for worktrees, review, merging, and session discipline; the [runbook](../docs/operator-runbook.md) owns recovery and gate procedures. This brief does not duplicate those policies.
