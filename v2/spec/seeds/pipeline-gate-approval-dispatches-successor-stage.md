---
name: pipeline-gate-approval-dispatches-successor-stage
---

# Pipeline gate approval must dispatch the successor stage, and a pending-stranded pipeline must be recoverable

## Problem

**REGRESSION** — the approval gate previously dispatched the successor stage (operator-confirmed, 2026-08-31). The prime bisect target is the recent front-door dispatch rework (`pipeline-dispatch-shares-cli-front-door`: final slice #3226 plus #3143/#3155/#3170), which reworked how pipeline stages resolve and dispatch.

Two coupled defects observed dogfooding a `full-review` pipeline (2026-08-31, pipeline `65f073b8`):

1. **Post-approve successor dispatch silently never fired.** After `jarvis pipeline approve <id> approve-intent default` durably recorded the gate decision (`status: approved`, `decidedAt` set), the successor `plan` stage stayed `status: pending` with `workflowInvocationId: null` and no run row was ever created — for 17+ minutes. The daemon was healthy the whole time (`daemon status` `loaded == current`, single socket, not superseded) and its process log carried only the startup line: no dispatch attempt, no error.
2. **A `pending`-stranded pipeline has no CLI recovery.** Both `jarvis pipeline resume <id>` and branch-scoped `jarvis pipeline resume <id> default` refuse with `pipeline_not_resumable` because the pipeline's derived state is `pending`, not `failed`/`awaiting-approval`. `pipeline approve` re-issue refuses `status_not_awaiting`. Only a daemon restart's continuation sweep can advance it.

**Confirmed hard regression (both gates, clean daemon).** Reproduced a second time on a daemon started via `jarvis daemon start` (not auto-started): after the daemon-restart continuation sweep recovered the pipeline and drove the plan stage, `jarvis pipeline approve <id> approve-plan default` (exit 0, stage `✓approve-plan`) again left the `implement` stage `pending` with no run row and no daemon-log line — the pipeline fell straight back to `pending`. Local `main` was pre-#3272 so no digest rotation occurred; the single clean daemon (`loaded == current`) did not dispatch. So the defect is in the approve-time dispatch path itself, not an auto-started/digest-churn artifact. The daemon-restart continuation sweep (`recoverContinuablePipelines`) DOES dispatch — recovery works, live approval does not. (2) is a recovery-surface gap that leaves the pipeline stuck without an operator daemon bounce.

## Evidence

- Pipeline `65f073b8` (`full-review`, jarvis project, render-coverage seed): `intent` succeeded, `approve-intent` approved at ts `1788199306555`, `plan` stage `pending`/`workflowInvocationId: null` indefinitely; `jarvis run list --all` showed only the two `intent/render-coverage…` rows — no plan run ever created.
- `jarvis pipeline resume 65f073b8` → `pipeline_not_resumable`; `jarvis pipeline resume 65f073b8 default` → `pipeline_not_resumable`; re-`approve` → `status_not_awaiting`.
- Second reproduction (clean daemon): `approve-plan` on pipeline `65f073b8` left `implement` `pending`, no run row; daemon `loaded == current == 3959dd1f`, single socket, startup-only log.

## Code loci

- On approve, `applyPipelineApprovalDecision` (`v2/src/daemon/pipeline-execution.ts:604`) fires `continuePipeline(...)` detached and logs any throw as `Pipeline <id> continuation after approval failed:`. The daemon log had NO such line — continuation was invoked, threw nothing, and returned without dispatching (a silent `return`).
- The approval handler (`daemon.ts:2196`) and the startup sweep (`daemon.ts:2400` → `recoverContinuablePipelines`) use the SAME `pipelineExecutionDeps()` factory (`daemon.ts:2117`) — so it is NOT a deps difference. Both call `continuePipeline` → `runPipeline`.
- The continuation claim is NOT the blocker on one daemon: `claimPipelineContinuation` (`v2/src/persistence/state-store.ts:1583`) fast-paths `applied` when `ownerIdentity === currentIdentity && status === active`, so a same-daemon re-claim after approval succeeds.
- So the silent non-dispatch is inside `runPipeline`'s stage-advance-after-approval logic: the successor stage is reached but neither dispatched nor failed. The loud advance path (`~pipeline-execution.ts:2001-2061`) fails via `failWorkflowStageAt` (would show `failed`+`failureDetail`, not seen); the silent skip is either the linked/settlement helper's `if (steps === undefined) return "skip";` (`~1821`, old code #2566) reached with `steps` undefined, or a runPipeline advance-eligibility guard returning early for the just-approved gate's successor.
- **Prime bisect target: #3170 "Dispatch pipeline stages through shared workflow preparation"** (front-door slice) reworked how a stage's `steps` are prepared/resolved for dispatch; if it left the approval-continuation path resolving `steps` undefined (while the startup sweep resolves them), that is the regression. Secondary suspects on the same file: #3155, #3250.

## Reproduction (deterministic)

Start a `full-review` pipeline on any single-behavior seed on a cleanly-started daemon, approve the intent gate: the plan stage stays `pending` with no run row. A `jarvis daemon stop && start` recovers it (sweep dispatches); the very next gate approval stalls again. Confirmed on both `approve-intent` and `approve-plan`, pipeline `65f073b8`.

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
