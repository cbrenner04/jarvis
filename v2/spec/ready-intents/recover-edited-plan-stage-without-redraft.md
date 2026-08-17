---
name: recover-edited-plan-stage-without-redraft
---

# Recover an Edited Plan Stage Without Redrafting

## Prerequisites

## Surface

Execution loop.

## Problem

- A plan draft that settles `contract_miss` or remains blocked in `.jarvis-plan-stage/` can only be redrafted, so an operator correction is discarded and the branch remains stranded.

## Behavior

- A deliberate recovery path revalidates the existing operator-edited `.jarvis-plan-stage/`, continues through any remaining review and publication work, publishes the corrected tree to the configured durable spec directory, consumes the ready-intent, and never invokes plan drafting or commits a staging sidecar; an uncorrected stage fails visibly and remains available for another correction.

## Decisions

- Admit recovery from a populated plan stage even when the stopped run reports `resumable: false`; rules out treating generic auto-resume eligibility as the operator-recovery contract.
- Re-run the normal plan-tree contract and landing validation against staged bytes before review or publication; rules out trusting an operator edit without the same checks as a clean plan run.
- Preserve the staged tree on failed revalidation and publish through the normal plan landing and ready-intent-consumption path on success; rules out destructive retries or a second publication implementation.
- Exclude `.jarvis-plan-stage/` and every staging sidecar from the publication commit; rules out the observed staging-tree leak onto the real branch.

## Required verification

- An execution regression reproduces the out-of-union `## Decisions` contract miss, edits the staged subspec, recovers without a draft-agent invocation, and proves the edited bytes reach the durable spec tree while the ready-intent is consumed.
- Negative coverage leaves the contract violation in place and proves recovery reports the validation reason, publishes nothing, consumes nothing, and preserves the staged tree.
- Publication coverage proves the resulting commit contains the durable spec tree and ready-intent deletion but no `.jarvis-plan-stage/` or verdict sidecar.

## Documentation updates

- `v2/docs/workflow-runner.md` — populated plan-stage recovery, revalidate-and-continue semantics, `resumable: false` distinction, failure retention, and publication-sidecar exclusion.
- `v2/docs/v1-behaviors.md` — additive operator recovery of corrected plan staging without redrafting.
