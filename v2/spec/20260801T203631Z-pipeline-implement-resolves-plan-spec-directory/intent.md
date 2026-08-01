---
name: pipeline-implement-resolves-plan-spec-directory
---

# Pipeline implement resolves plan spec directory to index

The `plan` stage records `specPath` as the spec directory; chained `implement` resolution passes it through and the implement builder rejects it before any run row exists.

Splitting does not apply: one pipeline handoff behavior at stage resolution (`daemon`); normalization may land in `resolveImplementStage` or `resolveImplementArtifact`, not both in one review.

## Decisions

- Plan→implement handoff resolves a directory artifact to `<dir>/index.md` for implement steps with no `--artifact` — rules out requiring operator `--artifact` on a chained stage.
- Deferred to first consumer: whether normalization runs in `resolveImplementStage` or `resolveImplementArtifact` — pin when implementing.
- A prior artifact that is neither a directory containing `index.md` nor an index file fails naming the resolved path and that an index was expected — rules out bare `Non-index spec requires --artifact`.
- Regression coverage feeds resolution the plan artifact shape `resolvePlanWorkflowStage` records today (bare directory), not a corrected index path — rules out fixtures that mask the handoff bug.
- Out of scope: fan-out claim contention and terminal-state defects in `seeds/pipeline-fanout-stage-dispatch-contends-on-the-prior-worktree`.

## Acceptance criteria

- [ ] `pipeline-stage-resolve.test.ts` — resolving `implement` with prior plan artifact `specPath` set to a bare spec directory yields implement steps with `specPath` `<dir>/index.md` and no `artifactPath`; fixture uses the recorded directory shape unchanged; fails against the baseline.
- [ ] `pipeline-stage-resolve.test.ts` — resolving `implement` when the prior artifact already names `index.md` still succeeds with that path; fails against the baseline if directory normalization overwrites an existing index path.
- [ ] `pipeline-stage-resolve.test.ts` — a prior directory artifact without `index.md` fails with a message naming the resolved path and that an index was expected; inverting the directory→index guard makes this test fail (source mutation on the real guard; pinning test comment names that mutation).
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — pipeline section: plan hands implement a bare spec directory; chained resolution normalizes to `<dir>/index.md`; resolution failure before any run row (stage `failure_detail`, no workflow run).
- `v2/docs/v1-behaviors.md` — pipeline inter-stage handoff entry (~line 223): replace pass-through `specPath` with plan directory artifact → implement `<dir>/index.md`; record resolution-time failure shape (resolved path, index expected).
- `v2/docs/daemon-host.md` — Seed/artifact hand-off: implement chained resolution normalizes directory `specPath` to `<dir>/index.md` at stage resolution (not pass-through); cross-link operator-runbook for pre-run failure symptoms.

## Prerequisites

- Inter-stage chained resolution reads artifact paths from the prior stage entry-run worktree, not `PipelineContext.cwd`.
- Plan stage completion records worktree-relative `specPath` as the spec directory on the stage artifact.
- `resolveStageWorkflowSteps` maps a realizable implement stage to the implement preset builder using the prior plan artifact's `specPath`.
- Stage resolution failures are recorded on the stage row as `failure_detail` before any workflow run row is created.
