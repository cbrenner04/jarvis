# Lane PR closed/merged outcomes settle past publication boundary

## Problem

After subspec 00, `createCompletionPublisher` can return `pushSha` with `lanePrOutcome` and without `prNumber`. `publishCompletionArtifacts` (`v2/src/execution/write-loop.ts`) still treats `pushSha` without `prNumber` as `completion_commit_failed` (`Pushed completion without PR evidence is a publication failure`). Resume/recovery republication therefore remains broken for closed or merged lane PRs until this slice maps `lane_pr_*` through publication consumers.

## Decisions

- `publishCompletionArtifacts` accepts publisher results that pair `pushSha` with `lanePrOutcome` without entering the missing-`prNumber` failure at the existing guard — rules out leaving lane refusal indistinguishable from a broken publish.
- Write-loop settlement when only `lanePrOutcome` is present: `terminalCause` and `loopOutcomeKind` stay `complete`; run row has no `prNumber`/`prUrl`; terminal `loop_finished` carries `lanePrOutcome`; ready finalization is skipped in `publishCompletionArtifacts`.
- Deferred to later consumers: pipeline stage settlement, notification sink copy, and run-row persistence of `lanePrOutcome` beyond the log event.

## Task checklist

- [ ] Thread `lanePrOutcome` from `runPublisher` / `CompletionPublisherResult` through `publishCompletionArtifacts` and adjust the `pushSha` without `prNumber` guard.
- [ ] Map `lane_pr_closed` / `lane_pr_merged` into write-loop / store settlement observable from tests (exact terminal shape pinned in this subspec’s decisions when implementing).
- [ ] Add regression coverage per acceptance criteria.
- [ ] Update operator-facing docs touched by settlement behavior (`v2/docs/workflow-runner.md` and/or `v2/docs/operator-runbook.md` as needed).

## Acceptance criteria

- [x] `write-loop.test.ts` (or colocated publication test): fake publisher returns `pushSha` plus `lanePrOutcome` `lane_pr_closed` with a PR number → `publishCompletionArtifacts` does not return `completion_commit_failed` with `Pushed completion without PR evidence`; fails against pre-fix guard at `publishCompletionArtifacts`.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — completion publication lane outcomes (`lane_pr_closed`, `lane_pr_merged`) and how the write loop settles them after subspec 00.
- `v2/docs/write-behavior.md` — remove or narrow the “operator gap” note once settlement is documented here.
