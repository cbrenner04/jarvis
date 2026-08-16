---
name: recover-one-blocked-pipeline-branch-stage
---

# Recover One Blocked Pipeline Branch Stage

## Prerequisites

- A populated operator-edited plan stage can be revalidated and continued through review and publication without plan drafting, preserves invalid staged bytes, consumes the ready-intent only on success, and excludes staging sidecars from commits.
- Branch-scoped pipeline resume can target one failed workflow stage by `branchKey` while leaving sibling branches and approval gates unchanged, including when the pipeline is globally awaiting a sibling approval.

## Surface

Daemon.

## Problem

- Pipeline resume sees a blocked plan run's `resumable: false` as terminal and can only fresh-dispatch the stage, so it cannot route an operator-fixed staged tree through in-place recovery.

## Behavior

- An explicit daemon recovery request targets one pipeline `branchKey`, admits its blocked plan stage independently of generic run resumability, invokes staged-tree revalidation and continuation on the linked run, re-settles that same stage, and advances only that branch after successful publication; sibling rows and gates never change, and an uncorrected block settles with its reason instead of success.

## Decisions

- Resolve recovery from the named durable pipeline stage and its linked entry run; rules out accepting an arbitrary run ID that is not the branch's current failed stage.
- Treat recovery as an opt-in mutation distinct from silent daemon restart and ordinary pipeline resume; rules out automatically retrying genuine dead ends or redrafting on restart.
- Re-settle the existing stage after the recovery attempt and continue its branch only after the linked run completes successfully; rules out marking recovery successful at admission or bypassing downstream gates.
- Return named admission refusals for an invalid target and settle an admitted but still-invalid stage with its validation reason; rules out `pipeline_not_resumable` or a success-shaped no-op.

## Required verification

- A daemon regression reproduces the `22041e31` shape, corrects the failed branch's staged out-of-union `## Decisions` bullet, invokes recovery, and proves that branch publishes and advances without a draft-agent invocation.
- The regression proves two sibling `approve-intent` gates and their branch rows are byte-for-byte unchanged across recovery.
- Negative coverage leaves the staged contract violation intact and proves the daemon records a clear validation failure, keeps the target stage failed, and dispatches no downstream stage.
- Admission coverage proves ordinary pipeline resume semantics remain unchanged and daemon restart never auto-recovers the blocked stage.

## Documentation updates

- `v2/docs/daemon-host.md` — branch-scoped blocked-stage recovery request, linked-run admission despite `resumable: false`, settlement, isolation, and refusal contract.
- `v2/docs/v1-behaviors.md` — additive daemon recovery for one operator-corrected pipeline branch stage.
