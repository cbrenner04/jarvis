# Resume dispatch threads republish opt-in to completion publication

## Problem

Resume RPC may carry `allowLanePrRepublish` after subspec 00, but daemon resume tails and workflow resume republication never set it on `CompletionPublisherInput`, so closed head+base history still blocks create and settles `lane_pr_closed` even when the operator passed the flag.

## Decisions

- Thread optional `allowLanePrRepublish?: true` from `resume` / `pipeline_resume` admission through every operator-initiated resume path that runs completion publication (`resumeReconstructedRun`, paused resume, intent/review finalization tails, linked workflow resume publication, and `resumeRunForPipeline`) — rules out wiring only bare write-loop resume and rules out setting the flag on non-publication resume continuations.
- Map RPC `allowLanePrRepublish === true` to `CompletionPublisherInput.allowLanePrRepublish: true` in `runPublisher` / `publishWithReadyRepair` / `publishCompletionArtifacts` inputs; omit the field when RPC omits it — rules out default-true publication and rules out a second alias on the publisher input.
- `pipeline recover` and recovery dispatch that republish without resume opt-in never set `allowLanePrRepublish` — rules out recover bypass aligned with intent.
- Internal `resume` calls (slot redrive, restart recovery) keep `{ runId }` only — rules out harness-wide implicit republish after closed lane PRs.
- Subspec 00’s CLI/RPC contract is the operator surface; this subspec does not rename the flag.
- Resume wiring does not branch on closed vs merged; extend prerequisite `completion-publisher.test.ts` so `allowLanePrRepublish: true` with newest head+base `MERGED` history calls `gh pr create` (paired with existing closed opt-in coverage) — rules out resume-only E2E for merged opt-in while intent’s closed-or-merged guard semantics stay publisher-owned.

## Task checklist

- [x] Plumb `allowLanePrRepublish` from `resumeHandler` / `resumeRunForPipeline` / `resumeAdmittedRunLifecycle` into write-loop and workflow-runner resume publication inputs.
- [x] Ensure `reconstructWriteResume` / `WriteLoopInput` (or equivalent resume spawn input) preserves the flag into `publishCompletionArtifacts`.
- [x] Ensure `workflow-runner-resume.ts` publication tails pass the flag into the completion publisher seam used on resume republication.
- [x] Pass the flag through `resumePipeline` → `resumeRunForPipeline` when `pipeline_resume` sets it.
- [x] Add focused daemon or execution unit coverage that resume with RPC opt-in reaches publisher input with `allowLanePrRepublish: true` when a publication resume runs (fake publisher or seam capture).
- [x] Extend `completion-publisher.test.ts` merged newest-history opt-in create per decisions.
- [x] Add end-to-end regression per acceptance criteria; update operator docs and v1 parity baseline.

## Acceptance criteria

- [x] `workflow-runner-publication.test.ts` or `pipeline-execution.test.ts`: resume republication with RPC `allowLanePrRepublish: true` and fake `gh` whose newest head+base PR is `CLOSED` calls `gh pr create` and lands draft PR evidence; fails against pre-fix resume path omitting publisher opt-in.
- [x] Same fixture resumed without the flag does not call `gh pr create`; `workflow-runner-publication.test.ts` `CLOSED head+base history settles terminal lane_pr_closed without failed status or duplicate create` stays green (paired assertion, preservation).
- [x] `completion-publisher.test.ts`: `allowLanePrRepublish: true` with newest head+base `MERGED` history calls `gh pr create`; fails against pre-fix if merged opt-in create is untested at publisher seam.
- [x] `pipeline-execution.test.ts` or extended `daemon-pipeline-recover.test.ts`: `pipeline recover` with fake `gh` whose newest head+base PR is `CLOSED` does not call `gh pr create` (no resume opt-in); fails against pre-fix recover republication that recreated drafts after closed lane PR history.
- [x] `run.test.ts` and `pipeline.test.ts` — resume CLI/RPC forwarding cases from subspec 00 stay green.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — closing a lane PR is final for automatic republication on resume/recover without opt-in; intentional new draft on the same branch uses `jarvis run resume` or `jarvis pipeline resume` with `--allow-lane-pr-republish`.
- `v2/docs/workflow-runner.md` — replace the “no workflow CLI flag yet” gap with the shared resume flag and pointer to the runbook.
- `v2/docs/v1-behaviors.md` — record that v2 resume/pipeline resume may opt into republish after closed/merged lane PR history via `--allow-lane-pr-republish`, while recover and other non-resume entry points do not.
