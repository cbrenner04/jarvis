---
name: pipeline-gate-approval-dispatches-successor-stage
---

# Pipeline gate approval must dispatch the successor stage, and a pending-stranded pipeline must be recoverable

## Problem

Two coupled defects observed dogfooding a `full-review` pipeline (2026-08-31, pipeline `65f073b8`):

1. **Post-approve successor dispatch silently never fired.** After `jarvis pipeline approve <id> approve-intent default` durably recorded the gate decision (`status: approved`, `decidedAt` set), the successor `plan` stage stayed `status: pending` with `workflowInvocationId: null` and no run row was ever created — for 17+ minutes. The daemon was healthy the whole time (`daemon status` `loaded == current`, single socket, not superseded) and its process log carried only the startup line: no dispatch attempt, no error.
2. **A `pending`-stranded pipeline has no CLI recovery.** Both `jarvis pipeline resume <id>` and branch-scoped `jarvis pipeline resume <id> default` refuse with `pipeline_not_resumable` because the pipeline's derived state is `pending`, not `failed`/`awaiting-approval`. `pipeline approve` re-issue refuses `status_not_awaiting`. Only a daemon restart's continuation sweep can advance it.

The likely trigger for (1): the daemon owning the pipeline was auto-started by a `jarvis` CLI command (not `jarvis daemon start`); an auto-started daemon may not drive the in-memory continuation that turns a durable gate approval into a successor dispatch. Regardless of trigger, (2) is a recovery-surface gap that leaves the pipeline permanently stuck without an operator daemon bounce.

## Evidence

- Pipeline `65f073b8` (`full-review`, jarvis project, render-coverage seed): `intent` succeeded, `approve-intent` approved at ts `1788199306555`, `plan` stage `pending`/`workflowInvocationId: null` indefinitely; `jarvis run list --all` showed only the two `intent/render-coverage…` rows — no plan run ever created.
- `jarvis pipeline resume 65f073b8` → `pipeline_not_resumable`; `jarvis pipeline resume 65f073b8 default` → `pipeline_not_resumable`; re-`approve` → `status_not_awaiting`.
- Daemon `46b8b3fd…` process log was one line (startup); `daemon status` reported `loaded == current` (no supersede).

## Decisions

- A durable gate approval MUST result in the successor stage being dispatched (or the pipeline settling a named failure), on the daemon that admits the approval — including a daemon auto-started by a CLI command. Recording `approved` without dispatching a successor is the defect.
- `pipeline resume` MUST admit a pipeline stranded `pending` with an approved gate and an undispatched successor (dispatch the pending successor), not refuse `pipeline_not_resumable`. Branch-scoped resume MUST do the same for the named lane.
- Keep the existing `pipeline_not_resumable` refusal for genuinely non-recoverable terminal states (`succeeded`, `rejected`).

## Acceptance criteria

- [ ] A daemon/pipeline regression proves that approving a gate whose predecessor stage `succeeded` dispatches the successor stage (creates its run row / `workflowInvocationId`) on the admitting daemon, including when that daemon was auto-started rather than `jarvis daemon start`; it fails against the pre-fix path where approval records `approved` and the successor stays `pending` with no run row.
- [ ] A regression proves `jarvis pipeline resume` on a pipeline stranded `pending` (approved gate, undispatched `pending` successor) admits and dispatches the successor instead of returning `pipeline_not_resumable`; branch-scoped resume does the same for the named lane.
- [ ] A regression proves `pipeline resume` still refuses `pipeline_not_resumable` on terminal `succeeded`/`rejected` pipelines.
- [ ] `bun run typecheck` and the test surfaces required by touched `v2/**`/`shared/**` files pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — § Pipeline resume: state that resume recovers a `pending`-stranded pipeline (approved gate, undispatched successor), and drop any implication that a daemon restart is the only recovery for that shape.
- `v2/docs/pipeline-execution.md` — record that gate approval dispatches the successor on the admitting (incl. auto-started) daemon, and that resume covers the `pending`-stranded shape.
