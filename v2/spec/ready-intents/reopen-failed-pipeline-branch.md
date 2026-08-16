---
name: reopen-failed-pipeline-branch
---

# Reopen One Failed Pipeline Branch

## Prerequisites

## Primary implementation surface

`v2/src/persistence/state-store.ts`

## Problem

The durable reopen transaction analyzes failures at pipeline scope, so a caller cannot select one fan-out branch while preserving sibling rows.

## Behavior

The state store can atomically reopen the valid failed continuation and skipped suffix for one named branch without mutating any sibling branch; omission of branch scope retains the current whole-pipeline contract.

## Decisions

- Branch-scoped shape analysis includes shared default-branch predecessors before the split and only the named branch at and after the split; rules out sibling gates, failures, and suffix rows affecting the target transaction.
- A named branch with no replayable failed continuation refuses without mutation and never falls back to whole-pipeline reopen; rules out accidental sibling replay.
- Omitting branch scope preserves current `reopenFailedPipeline` behavior and refusal semantics; rules out a compatibility change for existing recovery callers.
- Deferred to first consumer: persistence refusal vocabulary for an absent or non-failed named branch — pin when resume orchestration maps operator detail.

## Acceptance criteria

- [ ] `state-store.test.ts` fails against the baseline, then proves a named failed fan-out branch and only its skipped suffix reopen while sibling awaiting gates, failures, and lifecycle payloads remain byte-for-byte unchanged.
- [ ] `state-store.test.ts` proves absent, non-failed, duplicate, and racing branch-scoped reopen attempts refuse without partial mutation.
- [ ] Existing whole-pipeline `reopenFailedPipeline` tests stay green.

## Documentation updates

- `v2/docs/state-store.md` — branch-scoped reopen shape, atomicity, sibling isolation, and preserved unscoped behavior.
- `v2/docs/v1-behaviors.md` — v2 branch-scoped durable reopen behavior.
