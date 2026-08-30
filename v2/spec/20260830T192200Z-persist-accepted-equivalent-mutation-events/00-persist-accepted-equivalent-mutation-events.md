# Persist accepted equivalent-mutation events

## Problem

An accepted equivalent mutation can let completion proceed, but the durable run log has no record distinguishing that reviewed exemption from fully killed mutation coverage.

## Surface

Durable run-log persistence in `v2/src/persistence/log-stream.ts`; completion mutation-verification wiring in `v2/src/execution/write-loop.ts`, `v2/src/execution/ready-finalize.ts`, and the review-mutation-resume verification tail in `v2/src/execution/workflow-runner.ts`; completion-path and CLI replay regressions; operator and parity docs.

## Decision ledger

- Append one durable `accepted_equivalent_mutation` event per verifier-reported `acceptedSites` entry carrying `file`, `line`, the full mutation string, and `reason`; rules out an aggregate count or a single event with an embedded list that cannot be audited against the source diff.
- Emit only from `verifyDiffDerivedMutations` pass `acceptedSites` on completion mutation verification; rules out the completion path rescanning source or trusting unvalidated comments.
- Reuse the existing `LogSink` structured run log and its normal `jarvis run log` replay path; rules out a separate allowlist, sidecar, or CLI-only message.
- Append no `accepted_equivalent_mutation` event when `acceptedSites` is empty; rules out zero-count or placeholder events.

## Tasks

- Add typed `accepted_equivalent_mutation` to `LogEvent` with `file`, `line`, `mutation`, and `reason` fields.
- Carry verifier `acceptedSites` through completion finalization and append one event per site after successful mutation verification on the write-loop ready-finalizer path and the workflow-runner review-mutation-resume verification tail, using a shared append helper.
- Add completion-path regressions with an exact `@mutate-equivalent` directive, multiple accepted sites, and a no-acceptance negative case; extend CLI replay coverage for the new event kind.
- Update `v2/docs/workflow-runner.md`, `v2/docs/operator-runbook.md`, and `v2/docs/v1-behaviors.md` as listed below.

## Acceptance criteria

- [x] `write-loop.test.ts` regression `persists accepted_equivalent_mutation after completion with an exact directive` drives implement completion through the real ready finalizer against a git fixture with an exact colocated `// @mutate-equivalent mutation=<JSON string> reason=<JSON string>` directive, asserts one durable `accepted_equivalent_mutation` event with matching `file`, `line`, `mutation`, and `reason`, and fails against the prerequisite-only path that completes without the event.
- [x] `write-loop.test.ts` regression `persists distinct accepted_equivalent_mutation events per site and none when acceptedSites is empty` proves multiple accepted sites produce distinct events in verifier order and a successful completion with no accepted sites appends no `accepted_equivalent_mutation` event; it fails against the pre-fix path that omits multi-site persistence or emits on empty acceptance.
- [x] `run.test.ts` regression proves `jarvis run log <run-id>` replays persisted `accepted_equivalent_mutation` records through the existing structured-log JSONL path with no separate lookup; it fails against the pre-fix replay corpus that lacks the event kind.
- [x] `v2/docs/workflow-runner.md` documents `accepted_equivalent_mutation` emission at completion mutation verification and replaces the verifier-only note that downstream lifecycle logging of accepted sites is out of scope.
- [x] `v2/docs/operator-runbook.md` documents using `jarvis run log` to audit accepted equivalent mutations against the PR diff.
- [x] `v2/docs/v1-behaviors.md` records durable audit events for the v2-only equivalent-mutation escape hatch.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — `accepted_equivalent_mutation` emission at completion mutation verification; remove the out-of-scope downstream-logging note for accepted sites.
- `v2/docs/operator-runbook.md` — audit accepted equivalent mutations with `jarvis run log` against the PR diff.
- `v2/docs/v1-behaviors.md` — durable audit events for the v2-only equivalent-mutation escape hatch.
