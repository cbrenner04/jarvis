# Pipeline execution bypass rationale guard

## Problem

`pipeline-execution.ts` documents paths that deliberately skip durable stage claims or aggregate `derivePipelineState` admission. Without a pinned rationale or a structural guard, new bypass prose can land silently and reintroduce undocumented cross-process ownership exceptions.

## Surface

Primary: `v2/src/daemon/pipeline-execution.ts`. In-scope: a repo-local structural guard under `v2/src/daemon/` or `scripts/`, `pipeline-stage-recovery.ts` audit only (recovery already claims at admission).

## Prerequisites

- Subspec 00 landed: adoption routes through durable `pipeline_stage_admission`.
- Recovery admission claims before attempt (`v2/spec/completed/20260817T184346Z-recover-one-blocked-pipeline-branch-stage/`).

## Decision ledger

- Every intentional bypass of durable stage admission or aggregate `derivePipelineState` in `pipeline-execution.ts` carries an adjacent `@pinned-bypass:` line with a one-line rationale naming the observable behavior it preserves; rules out undocumented bypass prose surviving review as an accidental contract.
- Branch-scoped `resumePipeline` keeps `resolveBranchResumeAdmission` instead of aggregate `derivePipelineState` — pin with rationale that lane admission must not reopen or mis-scope sibling branches; rules out routing branch-scoped resume through aggregate derivation and changing fan-out resume semantics.
- Recovery paths outside `pipeline-execution.ts` are audited, not rewritten: `claimResolvedPipelineBranchStageRecovery` already owns durable admission; rules out duplicating recovery claim wiring in this slice.
- Structural guard fails on `bypass` tokens in `pipeline-execution.ts` production source that lack a same-block `@pinned-bypass:` marker reachable on the pre-fix tree at `resolveBranchResumeAdmission` and `resumePipeline` branch-scope docs; rules out silent new bypasses without CI signal.

## Task checklist

- Inventory every `bypass` mention and every adoption/dispatch path that still skips durable admission in `pipeline-execution.ts`; route through the claim helper from subspec 00 or add `@pinned-bypass:` with rationale.
- Retire or rewrite stale bypass comments that contradict post-00 behavior (for example prose implying adopt paths never take durable claims).
- Add a structural guard (for example `guard-pipeline-execution-bypasses.ts` + co-located test) that scans `v2/src/daemon/pipeline-execution.ts` and fails when `bypass` appears without a nearby `@pinned-bypass:` in the same comment block; the guard must fail against the pre-fix unpinned `resumePipeline` branch-scope bypass comment.
- Add structural or source audit test confirming `claimResolvedPipelineBranchStageRecovery` claims before `runClaimedRecoveryAttempt` and `runClaimedRecoveryAttempt` releases admission in `finally` with no gap.
- Update `v2/docs/pipeline-execution.md` to retire superseded bypass prose or cross-link each remaining pinned bypass to its rationale.
- Run `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2`.

## Acceptance criteria

- [ ] `v2/src/daemon/guard-pipeline-execution-bypasses.test.ts` fails against the pre-fix tree where `resumePipeline`'s branch-scope bypass comment lacks `@pinned-bypass:` and passes once every `bypass` token in `v2/src/daemon/pipeline-execution.ts` is pinned or removed.
- [ ] `v2/src/daemon/pipeline-stage-recovery.test.ts` test `recovery admission claims before attempt and releases in finally` (or equivalent structural audit) confirms `claimResolvedPipelineBranchStageRecovery` precedes `runClaimedRecoveryAttempt` and `releasePipelineStageAdmission` runs in `finally` with no admission gap; fails if claim moves after attempt start or release is omitted.
- [ ] `v2/src/daemon/pipeline-stage-recovery.test.ts` test `recovery refuses a stage whose admission claim is held` stays green.
- [ ] `v2/docs/pipeline-execution.md` retires or pins every documented bypass of durable admission or aggregate derivation and names branch-scoped resume as an intentional pinned exception.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/pipeline-execution.md` — retire or pin documented bypasses; cross-link branch-scoped resume exception.
