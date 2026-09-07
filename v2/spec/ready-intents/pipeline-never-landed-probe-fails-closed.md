---
name: pipeline-never-landed-probe-fails-closed
---

# Pipeline never-landed classification fails closed

## Prerequisites

- Cleanup PR ownership probing represents `gh` failure separately from a confirmed zero-open-PR result.
- Cleanup destructive admission refuses before mutation on unknown PR ownership and names `gh` reachability plus sandbox-safe recovery.

## Module-boundary surface

- Pipeline execution-loop never-landed classification and disposable-lane admission in `v2/src/commands/cleanup.ts` and `v2/src/daemon/pipeline-execution.ts`

## Problem

- Pipeline resume uses `classifyNeverLandedLane` to authorize disposable-lane retirement and operator-blocker bypass, but an unreachable `gh` can be mistaken for proof that the lane has no open PR.

## Behavior

- Never-landed classification exposes unknown PR ownership as an inconclusive result, not as `neverLanded: true` or an unlabelled negative.
- Pipeline resume refuses and preserves the lane when classification is inconclusive; it neither marks the lane disposable nor bypasses its operator blocker.
- The refusal names `gh` reachability and sandbox-safe recovery through the existing pipeline failure detail.
- A confirmed no-open-PR lane that otherwise meets the structural predicate retains current disposable rematerialization and blocker-bypass behavior.

## Decision ledger

- Give never-landed classification an explicit inconclusive outcome carrying the PR-probe reason; rules out boolean `false` discarding the cause before pipeline admission.
- Propagate inconclusive classification as a pipeline refusal before disposable marking or blocker bypass; rules out a failed probe authorizing destructive or bypass behavior.
- Preserve the structural never-landed predicate after a confirmed PR-free result; rules out disabling disposable restart for valid empty lanes.

## Acceptance criteria

- [ ] `v2/src/commands/cleanup.test.ts` proves `classifyNeverLandedLane` returns an inconclusive result when `gh pr list` throws and never classifies the lane as never-landed; it fails against a classifier that treats probe failure as no PR.
- [ ] `v2/src/daemon/pipeline-execution.test.ts` proves failed-plan resume with an inconclusive PR probe preserves the worktree, does not pass `disposableLane`, does not bypass a staged operator blocker, and records a failure naming `gh` reachability and sandbox recovery; it fails against the pre-fix permissive classification.
- [ ] `v2/src/daemon/pipeline-execution.test.ts` existing never-landed resume cases remain green for a confirmed zero-open-PR lane.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/pipeline-execution.md` — document inconclusive never-landed classification and refusal before disposable-lane admission or blocker bypass.
- `v2/docs/operator-runbook.md` — add pipeline resume recovery when sandboxed `gh` makes PR ownership inconclusive.
- `v2/docs/v1-behaviors.md` — record fail-closed pipeline classification and disposable-lane admission.
