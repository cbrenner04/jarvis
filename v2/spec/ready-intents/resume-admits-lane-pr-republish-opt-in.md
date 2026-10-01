---
name: resume-admits-lane-pr-republish-opt-in
---

# Resume paths admit an explicit opt-in to republish after closed lane PR history

## Problem

Operators who intentionally re-run a lane on a branch whose lane PR was closed have no supported admission flag; the harness either silently opens another draft (pre-fix) or refuses without documenting how to opt in.

## Decisions

- `jarvis run resume` and `jarvis pipeline resume` accept one shared opt-in flag (name chosen at plan) that threads through daemon resume dispatch onto `CompletionPublisherInput` republish opt-in.
- Without the flag, resume-driven publication keeps the closed-or-merged guard from publication resolution.
- `jarvis pipeline recover` and other non-resume republication entry points do not admit the opt-in flag; they keep the closed-or-merged guard with no supported bypass (intentional republication after a closed lane PR uses resume with opt-in).

## Acceptance criteria

- [ ] `run.test.ts` and `pipeline.test.ts`: resume invocations forward the opt-in flag to the daemon resume RPC payload; without the flag the payload omits it.
- [ ] `pipeline-execution.test.ts` or `workflow-runner-publication.test.ts`: end-to-end resume with opt-in and fake `gh` closed newest history creates a new draft; the same resume without opt-in does not call `gh pr create`; fails against pre-fix silent recreate.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — closing a lane PR is final for automatic republication; re-run resume with the opt-in flag to open a new draft on the same branch.

## Prerequisites

- Completion publication lists head+base PRs with full state before creating and honors republish opt-in on `CompletionPublisherInput` when set.
- `lane_pr_closed` and `lane_pr_merged` settle runs and linked pipeline stages without opening another draft when opt-in is absent.
