# Deferred settlement carries PR evidence and fails missing publication at stage settlement

## Problem

After `pipeline resume` drives deferred settlement (`pipeline-resume-drives-deferred-settlement`, #3012), a succeeded implement stage artifact can lack `prNumber`/`prUrl` even though completion publication succeeded, so terminal `ready`/`merge` fails with the generic `PR evidence required: prNumber and prUrl must be present` (`v2/src/execution/terminal-publication.ts`). `stageArtifactFromEntryRun` already copies PR fields from the linked entry run (`v2/src/daemon/pipeline-stage-dispatch.ts`), but settlement can read `completed` before publication persists evidence (subspec 00), and `applyEntryRunSettlement` still settles `succeeded` for `ready`/`merge` pipelines whose completed entry run lacks a complete PR pair — reachable today in `pipeline-execution.test.ts` test `resume drives settlement for a stage wedged behind a durably terminal entry run`, which seeds a terminal entry run without PR fields and never asserts artifact evidence or terminal success.

## Surface

Daemon: deferred-settlement stage artifact construction in `pipeline-stage-dispatch.ts` and terminal-action admission in `pipeline-execution.ts`. Depends on subspec 00 landing first. Out of scope: relaxing `executeTerminalPublication`'s artifact contract, branch lookup inside terminal publication, and changing general no-content completion semantics.

## Decision ledger

- Resume-driven and sweep-driven deferred settlement build the succeeded artifact from a fresh `loadRun` of the linked entry run through `stageArtifactFromEntryRun`, copying the complete `prNumber`/`prUrl` pair when present; rules out terminal publication rebuilding evidence from branch state or relaxing its artifact contract.
- When the admitted pipeline's `terminalAction` is `ready` or `merge`, a `completed` rollup whose linked entry run lacks either PR field settles the stage `failed` with completion-publication-specific vocabulary naming the missing evidence and invokes no terminal publication; rules out settling `succeeded` and deferring diagnosis to the generic terminal `PR evidence required` message. `leave-draft` and pipelines with no terminal action keep today's settlement semantics.
- `executeTerminalPublication` keeps today's fail-fast contract for a directly supplied artifact without complete evidence and its success contract for one carrying both fields — rules out changing terminal publication to hunt entry-run evidence.
- General no-content / empty-branch completion semantics stay unchanged — rules out forcing empty branches to publish solely to repair pipeline settlement.

## Task checklist

- [ ] In `applyEntryRunSettlement`, when rollup is `completed` and the pipeline's admitted `terminalAction` is `ready` or `merge`, require a complete PR pair on the freshly loaded entry run before writing `succeeded`; otherwise settle `failed` with `failureDetail.code: "completion_publication_missing_pr_evidence"` and a message naming completion publication leaving no confirmed PR evidence on the linked entry run (distinct from `TerminalPublicationError`'s generic PR-evidence message) and do not invoke terminal publication.
- [ ] Extend the existing `pipeline resume` deferred-settlement regression in `pipeline-execution.test.ts` to seed published PR evidence on the wedged entry run, assert the settled artifact carries `prNumber`/`prUrl`, and assert terminal `ready` publication succeeds once.
- [ ] Add a deferred-settlement regression where the completed linked entry run lacks a complete PR pair and prove stage `failed` with the completion-publication-specific diagnostic, `terminalPublicationCalls === 0`, and no `terminal_publication_failure` carrying the generic PR-evidence message.
- [ ] Keep existing deferred-settlement, terminal-publication, and publication-failure coverage green.
- [ ] Update the durable docs listed below; remove the operator-runbook gotcha bullet for this defect when shipped.

## Acceptance criteria

- [ ] `v2/src/daemon/pipeline-execution.test.ts` test `resume drives settlement for a stage wedged behind a durably terminal entry run` seeds PR evidence on the linked entry run, proves the wedged stage settles `succeeded` with artifact `prNumber`/`prUrl` matching the entry run, dispatches the successor, and runs terminal publication once successfully; it fails against the pre-fix path reachable today (artifact lacks PR fields and/or terminal publication records generic PR-evidence failure).
- [ ] `v2/src/daemon/pipeline-execution.test.ts` — `resume drives settlement for a stage wedged behind a durably terminal entry run`; Keystone checkpoint: the test body carries `// @mutate v2/src/daemon/pipeline-stage-dispatch.ts "...(entryRun.prNumber != null ? { prNumber: entryRun.prNumber } : {})," -> "...(false ? { prNumber: entryRun.prNumber } : {}),"` — dropping PR evidence from the settled artifact — and the test turns RED when applied.
- [ ] `v2/src/daemon/pipeline-execution.test.ts` test `deferred settlement fails when a ready pipeline's completed entry run lacks publication PR evidence` seeds a `settlement_deferred`/`entry_run_still_live` implement stage whose linked entry run is `completed` without a complete PR pair, drives settlement through `resumePipeline` (or `adoptAndSettlePipelineStage` when that is the exercised path), proves the stage settles `failed` with a completion-publication-specific diagnostic naming the missing evidence, `terminalPublicationCalls === 0`, and the pipeline records no `terminal_publication_failure` whose message is `PR evidence required: prNumber and prUrl must be present`; it fails against the pre-fix code that settles `succeeded` and pushes the generic terminal failure.
- [ ] `v2/src/daemon/pipeline-execution.test.ts` — `deferred settlement fails when a ready pipeline's completed entry run lacks publication PR evidence`; Mutation checkpoint: the test body carries `// @mutate v2/src/daemon/pipeline-stage-dispatch.ts "code: \"completion_publication_missing_pr_evidence\"" -> "code: \"ignored\""` and turns RED when applied.
- [ ] `pipeline-execution.test.ts` tests `continues pending terminal publication after restart`, `records terminal publication failure when success commit throws`, and `does not invoke terminal publication when the stage walk stops early` stay green (terminal publication keeps its direct-artifact fail-fast and success contracts).
- [ ] `v2/docs/daemon-host.md` records that deferred-settlement success artifacts carry entry-run PR evidence and that `ready`/`merge` pipelines fail at stage settlement with completion-publication-specific missing-evidence vocabulary instead of invoking terminal publication.
- [ ] `v2/docs/operator-runbook.md` records that `pipeline resume` preserves published PR evidence through deferred settlement so terminal `ready`/`merge` can land, names the stage-settlement diagnostic when completion publication left no PR evidence, and cross-links `pipeline-resume-drives-deferred-settlement`; remove the 2026-08-28 gotcha bullet for this defect.
- [ ] `v2/docs/v1-behaviors.md` records resume-driven deferred settlement carrying PR evidence into the stage artifact and stage-settlement failure for missing completion publication on `ready`/`merge` pipelines.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — deferred-settlement artifact carries PR evidence; missing-publication-evidence contract before terminal publication.
- `v2/docs/operator-runbook.md` — pipeline resume preserves published PR evidence and reports missing completion publication at stage settlement; cross-link `pipeline-resume-drives-deferred-settlement`.
- `v2/docs/v1-behaviors.md` — record resume-driven settlement carrying PR evidence into the stage artifact and stage-settlement failure for missing publication evidence.
