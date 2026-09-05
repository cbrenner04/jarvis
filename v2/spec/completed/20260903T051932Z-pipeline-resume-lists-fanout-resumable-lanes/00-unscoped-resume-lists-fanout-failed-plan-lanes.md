# Unscoped resume lists fan-out failed plan lanes

## Primary implementation surface

`v2/src/daemon/pipeline-execution.ts`

## Problem

Fan-out is the norm after intent split, but `jarvis pipeline resume <pipeline-id>` without a branch key either derives `awaiting-approval` continuation or refuses opaquely — operators detour through `pipeline list --json` to discover which `branch-key` to pass for a failed plan lane.

## Decision ledger

- Before unscoped `resumeAwaitingClaimsOnly` claim on aggregate `awaiting-approval`, scan fan-out branch suffixes and include a branch only when its first `failed` workflow row is at the `plan` stage (`workflow === 'plan'`) and `resolveBranchResumeAdmission` would reopen it (`reopenFailed: true`); when any qualify, refuse with `reason: "branch_resume_required"` and those `branchKey` values instead of claiming or returning opaque `pipeline_not_resumable`; rules out silent whole-pipeline claim and opaque refusal when branch-scoped resume is required (reachable today per operator-runbook § Pipeline resume and `setupFanOutResumeFixture` in `daemon-pipeline-resume.test.ts`).
- Listing scope is failed `plan` lanes only — exclude branches whose first `failed` row is not `workflow === 'plan'`, branches resumable only via approved-gate pending strand, and wedged `running`/`interrupted` lanes that already admit unscoped resume per runbook; rules out broadening discoverability beyond the fan-out failed-plan detour.
- When no such failed plan lanes exist, unscoped resume keeps today's `awaiting-approval` claim, approved-gate pending-strand dispatch, deferred-settlement, and other whole-pipeline paths unchanged; rules out regressing existing unscoped continuation.
- Listing is discoverability only — one refusal lists keys, does not reopen or dispatch multiple lanes; rules out implicit multi-lane dispatch.
- Refusal wire shape is `{ kind: "refused", pipelineId, reason: "branch_resume_required", branchKeys: string[] }`; CLI exits non-zero and prints the daemon `reason` plus every listed `branchKey` on stderr (listing deliberately prints keys — not reason-only formatting); rules out a success exit that only prints keys.
- Deferred to first consumer: exact stderr layout and sort order for listed branch keys — pin when the CLI formatter needs it.
- Deferred to TUI consumer: listing refusal `branchKeys` on the TUI resume surface — pin when TUI resume formatting needs discoverability parity.

## Tasks

- Add a fan-out branch scan in `resumePipeline`'s unscoped path that collects branch keys matching the failed-`plan`-only predicate above, evaluated immediately before `resumeAwaitingClaimsOnly` claim on aggregate `awaiting-approval`.
- Extend `ResumePipelineOutcome` refused shape and `PipelineResumeRefusalReason` with `branch_resume_required` carrying `branchKeys: string[]`.
- Parse and format the listing refusal in `v2/src/commands/pipeline.ts` so stderr carries `branch_resume_required` and every listed `branchKey`.
- Add daemon unit coverage in `pipeline-execution.test.ts` using a production-shaped fan-out fixture (approved gate + failed `plan` on one branch, sibling gates `awaiting`, aggregate `awaiting-approval`).
- Add handler coverage in `daemon-pipeline-resume.test.ts` driving unscoped `pipeline_resume` on the same fan-out fixture through the real handler/serialization path.
- Add CLI coverage in `pipeline.test.ts` driving unscoped `pipeline resume` against the listing refusal envelope.
- Update the operator, pipeline-architecture, and wire docs listed below.

## Acceptance criteria

- [x] `pipeline-execution.test.ts` drives unscoped `resumePipeline` on a fan-out pipeline whose derived state is `awaiting-approval` while at least one branch-scoped failed `plan` lane is branch-resumable and asserts `{ kind: "refused", reason: "branch_resume_required", branchKeys: [...] }` naming those keys instead of `{ kind: "resumed" }` or `{ reason: "pipeline_not_resumable" }` alone; fails against the pre-fix path that claims `awaiting-approval` without naming the failed branch (reachable via `setupFanOutResumeFixture` in `daemon-pipeline-resume.test.ts`).
- [x] `daemon-pipeline-resume.test.ts` drives unscoped `pipeline_resume` on the same fan-out fixture and asserts the handler returns `{ kind: "refused", reason: "branch_resume_required", branchKeys: [...] }` over the real serialization path instead of `{ kind: "resumed" }` or `{ reason: "pipeline_not_resumable" }` alone; fails against the pre-fix awaiting-approval claim path.
- [x] `pipeline.test.ts` drives `pipeline resume <pipeline-id>` with no branch key against the same listing refusal envelope and asserts non-zero exit with `branch_resume_required` and those `branchKey` values on stderr instead of exit `0` or stderr containing only `pipeline_not_resumable`; fails against the pre-fix awaiting-approval claim path.
- [x] `pipeline-execution.test.ts` drives unscoped `resumePipeline` on a fan-out fixture with two or more listable failed-`plan` branches under aggregate `awaiting-approval` and asserts `branchKeys` membership and count match every qualifying branch; fails against the pre-fix single-branch-claim path.
- [x] `pipeline-execution.test.ts` drives unscoped `resumePipeline` with `branchKey: "default"` on the same listing fixture and asserts the same `branch_resume_required` refusal and `branchKeys` as omission; fails against the pre-fix awaiting-approval claim path (`daemon-host.md` omission/`"default"` alias).
- [x] `pipeline-execution.test.ts` drives unscoped `resumePipeline` on aggregate `awaiting-approval` where the only resumable failure is a non-`plan` lane and asserts listing does not run — outcome is today's claim or existing refusal, not `branch_resume_required`; constructible on mixed fan-out with failed `implement` and no failed `plan`.
- [x] `pipeline-execution.test.ts` drives unscoped `resumePipeline` on aggregate `running` with a resumable failed-`plan` sibling and asserts listing does not run — outcome follows today's running-path behavior, not `branch_resume_required`; reachable via `unscoped and explicit-default resume do not dispatch under aggregate running` fixture shape.
- [x] `pipeline-execution.test.ts` proves unscoped `resumePipeline` still dispatches an approved-gate pending strand when a listable failed-`plan` sibling exists and aggregate derived state is `pending`; fails if the branch scan blocks dispatch — extends `unscoped resume dispatches an approved-gate pending strand without scoping to a failed sibling`.
- [x] `pipeline-execution.test.ts` — `unscoped and explicit-default resume do not dispatch under aggregate awaiting-approval` stays green (no listable failed-`plan` lanes in that fixture).
- [x] `pipeline-execution.test.ts` — `unscoped resume dispatches an approved-gate pending strand without scoping to a failed sibling` stays green.
- [x] `daemon-pipeline-resume.test.ts` — `pipeline_resume on awaiting-approval returns missing_context without dispatch` and `pipeline_resume on awaiting-approval returns claim_refused without dispatch` stay green.
- [x] `v2/docs/operator-runbook.md` documents that omitting `branch-key` on a fan-out pipeline with resumable failed plan lanes lists those lanes (`branch_resume_required`) instead of claiming `awaiting-approval` or opaque refusal, and that unscoped paths without such lanes are unchanged.
- [x] `v2/docs/pipeline-execution.md` records the `branch_resume_required` listing refusal in § Operator recovery under unscoped `pipeline resume`, including failed-`plan`-only scope and unchanged paths when no such lanes exist.
- [x] `v2/docs/daemon-host.md` records `branch_resume_required` with `branchKeys` in the `pipeline_resume` result union.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/operator-runbook.md` — § Pipeline resume: unscoped resume lists resumable failed plan branch keys (`branch_resume_required`) instead of claiming `awaiting-approval` or opaque refusal when such lanes exist; other unscoped paths unchanged.
- `v2/docs/pipeline-execution.md` — § Operator recovery / unscoped `pipeline resume`: `branch_resume_required` listing refusal, failed-`plan`-only scope, preservation of existing whole-pipeline paths.
- `v2/docs/daemon-host.md` — `pipeline_resume` result union: `branch_resume_required` with `branchKeys`.
