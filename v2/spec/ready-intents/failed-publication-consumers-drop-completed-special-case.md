---
name: failed-publication-consumers-drop-completed-special-case
---

# Status consumers key on `failed` + cause, dropping the `completed`-with-cause special case

`run list`/`wait` projection (`v2/src/cli/run-completion.ts`), stage settlement (`v2/src/daemon/pipeline-stage-recovery.ts`, `run-operator-error.ts`), and incident derivation (`v2/src/daemon/operator-incidents.ts`) treat publication failures as `failed` + cause; remove #3907's `completed`-with-failure-cause special case.

## Acceptance criteria

- [ ] A test proves incident derivation (`operator-incidents.ts`) emits `terminal:failed` for a `failed` `completion_commit_failed` row without the `completed`-with-cause special case.
- [ ] A test proves `run list`/`wait` projection (`run-completion.ts`) resolves a `failed` `completion_commit_failed` row as failed, not via the `completed`-with-cause special case.
- [ ] A test proves stage settlement (`pipeline-stage-recovery.ts`) treats a `failed` `completion_commit_failed` row as failed, not via the `completed`-with-cause special case.
- [ ] A test proves stage settlement (`run-operator-error.ts`) treats a `failed` `completion_commit_failed` row as failed, not via the `completed`-with-cause special case.

## Documentation updates

- `v2/docs/v1-behaviors.md` — reconcile the `completed`-with-cause entries for `run-operator-error.ts` (lines 29, 159, 274-278, 663) and `pipeline-stage-recovery.ts` (lines 55, 658, 705) with the special case's removal.

## Prerequisites

- Publication-tail failures (`completion_commit_failed`, `ready_flip_failed`) settle the run row `failed`, not `completed`.
- Existing `completed` rows with a non-`complete` terminal cause are migrated to `failed`.
