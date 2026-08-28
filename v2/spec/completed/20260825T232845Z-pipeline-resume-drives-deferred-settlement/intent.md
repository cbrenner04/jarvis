---
name: pipeline-resume-drives-deferred-settlement
---

# `pipeline resume` drives settlement for a stage wedged behind a terminal entry run

## Prerequisites

- A stage's settlement is derivable from its linked entry run's durable row alone, with no live terminal boundary event.
- Re-driving settlement on a `settlement_deferred`/`entry_run_still_live` stage advances a `completed` entry run's stage (dispatching the pending successor/publication) and fails a failed one, leaving a still-live entry run untouched.

## Problem

A pipeline already wedged in `settlement_deferred`/`entry_run_still_live` has no operator verb: `resumePipeline` derives `running` and refuses `pipeline_not_resumable`, and the entry run cannot be killed because it is already terminal (`run_not_active`). Startup reconciliation fixes the case going forward, but an operator facing a wedged pipeline on a daemon that is already up needs an explicit way out without bouncing the daemon.

## Decisions

- `pipeline_resume` treats a stage in `settlement_deferred` whose linked entry run is durably terminal as resumable and drives settlement instead of refusing `pipeline_not_resumable`, even though derived state reads `running`. Rules out the current dead end where the only recovery is a daemon restart.
- Derived `running` with no such wedged stage still refuses `pipeline_not_resumable` unchanged. Rules out widening resume into an interrupt of a genuinely running pipeline.

## Acceptance criteria

- [ ] `jarvis pipeline resume` on a pipeline whose stage is `settlement_deferred`/`entry_run_still_live` with a durably-terminal entry run drives settlement and returns `resumed` instead of `pipeline_not_resumable`, pinned by a test.
- [ ] A pipeline derived `running` with a genuinely live entry run still refuses `pipeline_not_resumable` with no stage mutation, pinned by a test.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — `pipeline_resume` RPC row and the resume-admission section: the `settlement_deferred`-with-terminal-entry-run exception to the derived-`running` refusal.
- `v2/docs/operator-runbook.md` — `pipeline resume` behavior for a stage wedged mid-settlement.
- `v2/docs/v1-behaviors.md` — the `pipeline_resume` admission bullet, per the rule that specs changing existing behavior update it.
