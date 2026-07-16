# Seed: parallel-planned sibling specs conflict once the core sibling lands

## Problem

The three publication/gate P0 seeds (`v2-run-reports-completed-over-a-red-gate`,
`publish-failure-is-always-a-transient-network-error`,
`failed-ready-flip-strands-the-run-and-hangs-the-cli`) were each split into intents and planned
in parallel off the **same base**, producing six specs that all edit the same
`write-loop.ts`/`workflow-runner.ts` publication path. Once the core sibling
`distinguish-ready-gate-and-flip-failures` (#1620) merged — renaming `ready_finalize_failed` →
`ready_gate_failed`/`ready_flip_failed` — every other sibling went stale/conflicting:

- `publication-failure-cause` (#1624): DON'T-MERGE, conflicts; re-run still built pre-split code.
- `publication-retries` (#1616): subspec "classify completion publication failures" is now
  **redundant** with #1620.
- `repair-red-gate-before-workflow-completion`, `failed-ready-flip-settles-workflow`: blocked on
  siblings; specs reference pre-split vocabulary.

## Decisions

- When one seed's fix necessarily reshapes a shared code seam, its siblings must be **planned
  against the merged result**, not in parallel off the pre-fix base.
- Consolidate the remaining publication concerns into ONE spec on post-#1620 code:
  (a) persist the real publication failure cause (de-mask "transient network error"),
  (b) arm the ready-gate repair loop before completion (the headline — `ready_gate_repair` has
  never fired), (c) settle/recover the run on a failed ready-flip (CLI hang + worktree claim).
  Drop the redundant classify-completion subspec (done by #1620).

## Acceptance criteria

- [ ] The stale siblings (`publication-failure-cause`, `publication-retries`, `repair-red-gate`,
      `failed-ready-flip-settles`) are pruned/superseded by one consolidated spec on post-#1620 code.
- [ ] The consolidated spec's ACs reference the `ready_gate_failed`/`ready_flip_failed` vocabulary.

## Documentation updates

- `v1/docs/spec-guidance.md` (or v2 equivalent) — note: plan interdependent siblings serially
  when they share a code seam; don't fan out parallel plans off a pre-fix base.
