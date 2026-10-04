# Pipeline end-to-end integration proof

## Problem

Slice-level daemon, CLI, and resolution tests can stay green while pipeline definition selection, stage dispatch, approval gates, failure resume, invocation linkage, and terminal `ready` settlement no longer compose.

## Surface

Primary: integration harness (`pipeline-end-to-end.sandbox-unrunnable.test.ts`) and operator docs. In-scope support seams: `pipeline-execution.ts` handler deps for `executeTerminalPublication` faking and existing resume guards (e.g. `resumeFailedRequiresReopen`) — no new production exports unless test-local observation cannot detect redispatch.

## Prerequisites

- Pipeline definitions and per-project resolution validate before admission (`pipeline-registry.ts`, `project-pipeline-resolution.ts`, `pipeline-definition-validation.test.ts`, `project-pipeline-resolution.test.ts`).
- Daemon pipeline execution durably records ordered stages, invocation linkage, lifecycle, artifacts, and failures (`pipeline-execution.ts`, `pipeline-stage-dispatch.ts`, `pipeline-execution.test.ts`, `pipeline-stage-dispatch.test.ts`).
- Approval decisions are durable; resume re-enters failed or awaiting stages without redispatching completed workflow stages (`daemon-pipeline-resume.test.ts`, `daemon-pipeline-approval.test.ts`, `pipeline-execution.test.ts`).
- Pipeline CLI start, list, wait, detach, approve, reject, and resume expose admission, stage state, approval boundaries, and terminal settlement (`pipeline.ts`, `pipeline.test.ts`).
- Configured `leave-draft`, `ready`, and `merge` terminal actions validate before admission and settle after the stage walk (`project-pipeline-resolution.test.ts`, `pipeline-execution.test.ts` — `settles each configured terminal action end to end`).

## Decisions

- One `test:integration:v2` case in `v2/src/daemon/pipeline-end-to-end.sandbox-unrunnable.test.ts` uses in-process `createRunControlHandlers` (same topology as existing daemon pipeline tests); `.sandbox-unrunnable` enrolls git/fixture/load partition only — not socket transport or a spawned daemon process.
- The case admits only through `pipeline_start` / `pipeline_approve` / `pipeline_resume` handlers — not out-of-band `runPipeline` — with agent invocation faked only at `dispatch` / `wait` / write-loop and terminal publication faked at handler-injected `executeTerminalPublication` (or equivalent seam in pipeline execution deps) — rules out shallow per-stage cases, CLI-only wiring, and live `gh`.
- Admission resolves `full-review` with `terminalAction: "ready"` through real `resolveProjectPipeline`; stage resolution follows the production handler `resolveStage` path — rules out hand-built definitions or stubbed resolution.
- Fixtures: `sandbox-git-repo`, registered project config with `projects.<name>.pipeline`, and artifact/seed files the `full-review` stages require — rules out bypassing definition validation or daemon dispatch.
- After every async handler return, the case polls durable state via `waitFor` / `loadPipeline` (especially post-`pipeline_resume`) — rules out races on skipped-suffix reset and background continuation.
- First `plan` dispatch fails by faking `wait` to return failed (or an equivalent controllable write-loop abort) — rules out unpinned failure injection inconsistent with `failed, skipped, skipped`.
- Completed `intent` retains its `workflowInvocationId` while resumed `plan` receives a new one — rules out restart-from-zero and resume redispatch of succeeded stages.
- Pinned durable status sequence (stage order `intent`, `approve-intent`, `plan`, `approve-plan`, `implement`): `pending×5` at admission; `succeeded, awaiting, pending, pending, pending` after `intent`; `succeeded, approved, running, pending, pending` when `plan` dispatches; `succeeded, approved, failed, skipped, skipped` on `plan` failure; `succeeded, approved, pending, pending, pending` after `pipeline_resume` before `plan` redispatches; `succeeded, approved, running, pending, pending` when resumed `plan` runs; `succeeded, approved, succeeded, awaiting, pending` after resumed `plan`; `succeeded, approved, succeeded, approved, running` when `implement` dispatches; workflow stages `succeeded`, gates `approved`, `derivePipelineState(...) === "running"` while terminal publication is in flight; `succeeded, approved, succeeded, approved, succeeded` after `ready` settlement with `terminalPublicationSucceededAt` set and `derivePipelineState(...) === "succeeded"` — rules out unpinned stage progression and final-outcome-only proof.
- Regression detection uses per-stage dispatch-count assertions in the composed case plus inversion of an existing resume guard (e.g. `resumeFailedRequiresReopen`) — test-local observation preferred; no mandatory new production invert exports.
- `v2/docs/first-workflow-walkthrough.md` owns the configured-pipeline operator walkthrough; `v2/docs/operator-runbook.md` states pipeline support for registered projects and links that section — rules out duplicating operator steps in architecture docs.
- Deferred to first consumer: additional pipeline fixtures beyond `full-review` + `ready` in this harness — pin when a second composed path needs the same proof shape.

## Task checklist

- Add `pipeline-end-to-end.sandbox-unrunnable.test.ts` with a `full-review` case on `createRunControlHandlers`, real `resolveProjectPipeline` + `resolveStage`, sandbox fixtures, handler-only admission, faked invocation and `executeTerminalPublication`, both gate approvals, first `plan` `wait` failure, resume, and `ready` settlement.
- Poll `waitFor` / `loadPipeline` after each handler boundary; assert every pinned vector in Decisions, including pre-dispatch resume reset and settlement-interval `running` state.
- Record `workflowInvocationId` for `intent` before failure; assert unchanged after resume and distinct ID on resumed `plan`.
- Add dispatch-count assertions and a resume-guard inversion subcase for AC3.
- Add a labeled configured-pipeline section to `first-workflow-walkthrough.md` (`projects.<name>.pipeline`, registration, when to use `jarvis pipeline start` vs direct `run start`, observe, approve, resume, terminal `ready`).
- Add a concrete Status or Prerequisites statement to `operator-runbook.md` that configured pipelines are supported for registered projects, plus link to the walkthrough section.

## Acceptance criteria

- [x] `v2/src/daemon/pipeline-end-to-end.sandbox-unrunnable.test.ts` — `full-review` fails against the baseline, then admits through `pipeline_start` / `pipeline_approve` / `pipeline_resume` with real `resolveProjectPipeline` and production `resolveStage`, fails first `plan` via faked `wait`, resumes, approves both gates, and reaches `ready` settlement with invocation and `executeTerminalPublication` faked only at those boundaries.
- [x] `v2/src/daemon/pipeline-end-to-end.sandbox-unrunnable.test.ts` — the case polls `waitFor` / `loadPipeline` after each handler return and observes every pinned durable status vector in Decisions, including pre-dispatch resume reset, settlement-interval `derivePipelineState(...) === "running"`, terminal `succeeded, approved, succeeded, approved, succeeded` with `terminalPublicationSucceededAt` set and `derivePipelineState(...) === "succeeded"`, and proves `intent` retains `workflowInvocationId` while resumed `plan` receives a new one.
- [x] `v2/src/daemon/pipeline-end-to-end.sandbox-unrunnable.test.ts` — dispatch-count assertions plus inverting an existing resume guard (e.g. `resumeFailedRequiresReopen`) make the named case fail when `intent`, `plan`, or `implement` is not dispatched or resume redispatches completed `intent`.
- [x] `bun run test:integration:v2` exits zero.
- [x] `v2/docs/first-workflow-walkthrough.md` — a clearly labeled configured-pipeline section (e.g. via `jarvis pipeline start`) documents prerequisites (`projects.<name>.pipeline`, project registration), when to use pipeline vs direct `run start`, and operator steps through approval gates, failure resume, and terminal `ready` settlement for `full-review`.
- [x] `v2/docs/operator-runbook.md` — adds a Status or Prerequisites statement that configured pipelines are supported for registered projects with `projects.<name>.pipeline`, and links the configured-pipeline walkthrough section in `first-workflow-walkthrough.md`.

## Documentation updates

- `v2/docs/first-workflow-walkthrough.md` — labeled configured-pipeline walkthrough (`projects.<name>.pipeline`, registration, pipeline vs `run start`, start, observe, approve, resume, terminal `ready`).
- `v2/docs/operator-runbook.md` — concrete pipeline-support statement and walkthrough link; no duplicate step-by-step in architecture docs.
