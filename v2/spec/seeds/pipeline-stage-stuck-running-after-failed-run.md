---
name: pipeline-stage-stuck-running-after-failed-run
---

# A pipeline stage whose run fails (e.g. quota) stays `running` forever and the pipeline is unrecoverable

## Problem

When a pipeline workflow stage's run terminates `failed` — for example `quota_exhausted` / `invocation_failure`, the single most common failure for this operator — the stage record is not settled to `failed`. It stays `status: running`, the pipeline's derived state stays `running`, and there is no recovery path:

- `jarvis pipeline resume <id> [<branch>]` refuses with `pipeline_not_resumable` (resume only reopens `failed` or `awaiting-approval` pipelines, not a `running` one).
- `jarvis pipeline recover` only applies to a `failed` `plan` stage.
- There is no live run to `jarvis run kill --force`, and killing the already-terminal failed run would not change the stuck stage record anyway.

The pipeline is dead in the water — the exact class the recovery cluster was meant to close, but for a stage stuck `running` rather than `blocked`/`failed`.

Observed 2026-08-23 dogfooding a `full-review` pipeline (`96830216`): the `implement` stage dispatched run `5d3cb6e8`, which committed one iteration (`9eee4258`) then terminated `failed` with `outcomeKind: invocation_failure` / `quota_exhausted`. The stage record stayed `running` with `workflowInvocationId: 5d3cb6e8` (the failed run); the pipeline stayed `running`; `pipeline resume … default` returned `pipeline_not_resumable`. The completed implement work had to be hand-published from the worktree, and the pipeline was dismissed rather than recovered.

## Decisions

- A pipeline workflow stage whose dispatched run reaches a terminal `failed` state must settle the stage to `failed` (recording the failure detail / linking the failed run), so the pipeline derives `failed` and becomes resumable. Rules out leaving the stage `running` after its only run has terminally failed. This is the primary fix — quota failure mid-stage is normal and must be recoverable via the existing `pipeline resume` replay.
- Cover the path where the failure arrives out-of-band (the run settles `failed` without the pipeline-execution success/settlement callback running — e.g. the daemon was mid-dispatch when the agent invocation failed): daemon-start / periodic reconciliation must detect a stage whose `workflowInvocationId` names a terminally-failed run while the stage is still `running`, and settle that stage `failed`. Rules out relying solely on the in-band settlement callback that a quota abort can skip.
- Provide an operator escape hatch for a stage stuck `running` whose linked run is terminal or absent: either `pipeline resume` treats such a stage as reopenable, or a force-settle verb marks it `failed` so the standard resume/recover path applies. Rules out an unrecoverable pipeline when reconciliation has not (yet) fired.
- Do not force-settle a stage whose linked run is genuinely still live — only when the linked run is terminal (or no run exists for a `running` stage). Rules out killing in-flight work.

## Acceptance criteria

- [ ] When a pipeline workflow stage's dispatched run terminates `failed` (`invocation_failure`/`quota_exhausted`), the stage settles to `failed` with its failure detail and linked run, and the pipeline derives `failed` — pinned by a daemon/pipeline-execution test that fails a stage run and asserts the stage/pipeline become `failed` (fails against the current code that leaves the stage `running`).
- [ ] After such a failure, `jarvis pipeline resume <id> [<branch>]` reopens and replays the failed stage instead of returning `pipeline_not_resumable` — pinned by a test.
- [ ] Startup/periodic reconciliation settles a stage still `running` whose `workflowInvocationId` names a terminally-failed run to `failed` — pinned by a reconciliation test seeding that inconsistent pair.
- [ ] A stage whose linked run is genuinely live is never force-settled by reconciliation — pinned by a test.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — recovery section: a stage whose run fails (including quota) now settles `failed` and is recoverable via `pipeline resume`; note the reconciliation backstop. Remove any implication that a mid-stage failure strands the pipeline.
- `v2/docs/daemon-host.md` — pipeline stage failure settlement and the running-stage-with-terminally-failed-run reconciliation rule.
