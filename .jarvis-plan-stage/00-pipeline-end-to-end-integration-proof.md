# Pipeline end-to-end integration proof

## Problem

Slice-level daemon, CLI, and resolution tests can stay green while pipeline definition selection, stage dispatch, approval gates, failure resume, invocation linkage, and terminal `ready` settlement no longer compose.

## Prerequisites

- Pipeline definitions and per-project resolution validate before admission (`pipeline-registry.ts`, `project-pipeline-resolution.ts`, `pipeline-definition-validation.test.ts`, `project-pipeline-resolution.test.ts`).
- Daemon pipeline execution durably records ordered stages, invocation linkage, lifecycle, artifacts, and failures (`pipeline-execution.ts`, `pipeline-stage-dispatch.ts`, `pipeline-execution.test.ts`, `pipeline-stage-dispatch.test.ts`).
- Approval decisions are durable; resume re-enters failed or awaiting stages without redispatching completed workflow stages (`daemon-pipeline-resume.test.ts`, `daemon-pipeline-approval.test.ts`, `pipeline-execution.test.ts`).
- Pipeline CLI start, list, wait, detach, approve, reject, and resume expose admission, stage state, approval boundaries, and terminal settlement (`pipeline.ts`, `pipeline.test.ts`).
- Configured `leave-draft`, `ready`, and `merge` terminal actions validate before admission and settle after the stage walk (`project-pipeline-resolution.test.ts`, `pipeline-execution.test.ts` — `settles each configured terminal action end to end`).

## Decisions

- One `test:integration:v2` case in `v2/src/daemon/pipeline-end-to-end.sandbox-unrunnable.test.ts` drives a real multi-stage pipeline through daemon-owned `pipeline_start` / `pipeline_approve` / `pipeline_resume` handlers with agent invocation faked only at the `resolveStage` + write-loop boundary — rules out shallow per-stage unit cases or CLI-only wiring tests.
- The case resolves `full-review` with `terminalAction: "ready"` through `resolveProjectPipeline` before admission — rules out injecting a hand-built definition that skips project config validation.
- The case reads durable `loadPipeline` stage rows after every boundary (`pending`, `running`, `awaiting`, `failed`, `skipped`, terminal) — rules out final-outcome-only proof that misses skipped-suffix reset.
- `plan` fails once on first dispatch, then succeeds after `pipeline_resume`; completed `intent` retains its `workflowInvocationId` while resumed `plan` receives a new one — rules out happy-path-only coverage, restart-from-zero, and resume redispatch of succeeded stages.
- Pinned durable status sequence (stage order `intent`, `approve-intent`, `plan`, `approve-plan`, `implement`): `pending×5` at admission; `succeeded, awaiting, pending, pending, pending` after `intent`; `succeeded, approved, running, pending, pending` when `plan` dispatches; `succeeded, approved, failed, skipped, skipped` on `plan` failure; `succeeded, approved, running, pending, pending` on resume; `succeeded, approved, succeeded, awaiting, pending` after resumed `plan`; `succeeded, approved, succeeded, approved, running` when `implement` dispatches; `succeeded×5` after terminal `ready` settlement — rules out unpinned stage progression.
- Terminal `ready` publication is faked at the `executeTerminalPublication` seam injected through pipeline execution deps — rules out live `gh` in the integration proof.
- Export invert hooks for resume-without-redispatch and per-stage dispatch guards; inverting them makes the named case fail — rules out assertions that do not pin regression detection.
- `v2/docs/first-workflow-walkthrough.md` owns the configured-pipeline operator walkthrough; `v2/docs/operator-runbook.md` marks pipelines usable and links that section — rules out duplicating operator steps in architecture docs.
- Deferred to first consumer: additional pipeline fixtures beyond `full-review` + `ready` in this harness — pin when a second composed path needs the same proof shape.

## Task checklist

- Add `pipeline-end-to-end.sandbox-unrunnable.test.ts` with a `full-review` case that resolves project pipeline config, admits through daemon handlers, approves both gates, fails `plan` once, resumes, completes `implement`, and settles `ready` with faked invocation and terminal publication.
- Assert the pinned status vector at every boundary listed in Decisions, including `skipped` suffix stages on failure and their reset to `pending` on resume.
- Record `workflowInvocationId` for `intent` before failure, assert it is unchanged after resume, and assert resumed `plan` carries a distinct invocation ID.
- Wire dispatch-count / redispatch guards with exported invert hooks for AC3.
- Add a configured-pipeline walkthrough section to `first-workflow-walkthrough.md` covering `projects.<name>.pipeline`, `jarvis pipeline start`, detached tracking, `pipeline wait` / `list`, approve gates, resume after failure, and terminal `ready` outcome.
- Update `operator-runbook.md` to state pipelines are usable for registered projects with `pipeline` config and link the walkthrough section.

## Acceptance criteria

- [ ] `v2/src/daemon/pipeline-end-to-end.sandbox-unrunnable.test.ts` — `full-review` fails against the baseline, then drives `resolveProjectPipeline` admission through daemon dispatch, fails `plan` once, resumes it, approves both gates, and reaches configured `ready` terminal settlement with agent invocation faked only at the boundary.
- [ ] `v2/src/daemon/pipeline-end-to-end.sandbox-unrunnable.test.ts` — the case observes the pinned durable status sequence at every boundary, including reset of skipped later stages on resume, and proves successful `intent` retains its `workflowInvocationId` while resumed `plan` receives a new one.
- [ ] `v2/src/daemon/pipeline-end-to-end.sandbox-unrunnable.test.ts` — inverting resume-without-redispatch or per-stage dispatch guards makes the named case fail, proving regression detection when `intent`, `plan`, or `implement` is not dispatched or resume redispatches completed `intent`.
- [ ] `scripts/test-slice.ts` — `bun run test:integration:v2` exits zero with the new `.sandbox-unrunnable.test.ts` file enrolled in the integration partition.
- [ ] `v2/docs/first-workflow-walkthrough.md` — documents an operator walkthrough for a configured `full-review` pipeline from `jarvis pipeline start` through approval gates, failure resume, and terminal `ready` settlement.
- [ ] `v2/docs/operator-runbook.md` — marks configured pipelines usable for registered projects and links the configured-pipeline walkthrough in `first-workflow-walkthrough.md`.

## Documentation updates

- `v2/docs/first-workflow-walkthrough.md` — configured pipeline walkthrough (`projects.<name>.pipeline`, start, observe, approve, resume, terminal `ready`).
- `v2/docs/operator-runbook.md` — pipeline usability statement and walkthrough link; no duplicate step-by-step in architecture docs.
