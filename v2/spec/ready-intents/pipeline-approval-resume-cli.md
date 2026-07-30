---
name: pipeline-approval-resume-cli
---

# Pipeline approval and resume CLI

## Prerequisites

- Reaching an approval stage durably records `awaiting`, and decisions durably target that stage ID.
- Awaiting approval state and pipeline continuation context survive state-store reopen and daemon reconciliation.
- Reopening a failed pipeline preserves prior succeeded stage identities, invocation IDs, and artifacts while making only the failed suffix eligible.
- Daemon approval advances only a matching awaiting stage, while rejection settles the pipeline terminally at that stage.
- Daemon pipeline resume re-enters the failed or awaiting stage and names completed and rejected refusal states.

## Problem

Daemon approval and pipeline resume are not operator-usable until the CLI exposes their stage-scoped contracts.

## Decisions

- `jarvis pipeline approve <pipeline-id> <stage-id>` and `jarvis pipeline reject <pipeline-id> <stage-id>` send the deciding stage ID; rules out an unscoped decision that can settle a stale or different gate.
- Only the first matching approval decision succeeds; duplicate or racing CLI decisions receive the daemon's named refusal and cannot dispatch another stage; rules out client-side last-writer-wins behavior.
- `jarvis pipeline resume <pipeline-id>` uses daemon stage-scoped resume; rules out translating resume into a fresh pipeline start.
- Named daemon refusals reach stderr with a nonzero exit; rules out reporting rejected decisions or terminal resume attempts as success.

## Acceptance criteria

- [ ] Approve and reject CLI commands send both pipeline and stage IDs and return success only when the daemon records the matching decision.
- [ ] The resume CLI command continues a failed pipeline without changing prior stage invocation IDs.
- [ ] Completed-pipeline and rejected-pipeline resume refusals are named on stderr and exit nonzero.
- [ ] An approval command against a non-awaiting or mismatched stage is refused without dispatching a later stage.
- [ ] `v2/src/cli.test.ts` regression coverage for pipeline approve, reject, and resume commands fails against the pre-fix CLI behavior.

## Documentation updates

- `v2/docs/write-behavior.md` — pipeline approve, reject, and resume command contracts.
- `v2/docs/operator-runbook.md` — deciding approval stages and what pipeline resume replays.
- `v2/docs/v1-behaviors.md` — v2 pipeline approval and resume CLI behavior.
