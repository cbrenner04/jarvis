# 02 - Prove recovery and duplicate-commit behavior

Finish Phase 1 by proving the boundary semantics the later daemon/runtime work
must inherit. This slice owns recovery reads, transactional proof coverage, and
the concrete duplicate-commit contract for already committed attempts. It should
show that kill-resume and crash-recovery collapse to the same step-boundary
rules without adding daemon lifecycle semantics or mid-step resume.

## Decisions

- Recovery is step-boundary only. The store never resumes mid-step.
- `loadRunForResume` must resolve to exactly one of:
  `start-next-boundary`, `replay-last-boundary`, or `run-terminal`.
- `start-next-boundary` means the current durable checkpoint has no recorded
  attempt yet.
- `replay-last-boundary` means an attempt exists for the checkpointed step but
  no committed boundary effect made the attempt terminal and advanced the run.
- `run-terminal` means `runs.status` is terminal and `runs.next_step_id` is
  absent after a committed terminal boundary. `next_step_id` absence alone is
  not enough.
- Duplicate `commitStepBoundary` calls for the same already committed attempt
  return the existing durable boundary snapshot. They must not create a second
  outcome row or advance `runs.next_step_id` twice.
- Proof coverage stays library-local with temporary SQLite databases and
  co-located tests under `v2/src`.

## Task checklist

- Implement the recovery read mapping for the three explicit Phase 1 outcomes.
- Finish the public `loadRunForResume` and `commitStepBoundary` semantics where
  the previous slice intentionally left proof obligations open.
- Add transactional tests for fresh, in-flight, committed, duplicate-commit,
  and terminal-run cases.
- Prove duplicate-commit behavior from the public API boundary, not only by
  inspecting internal SQL effects.
- Update durable docs in this slice if the concrete recovery/duplicate-commit
  rule tightens public semantics.

## Acceptance criteria

- [ ] A fresh run with no recorded attempt for its current `nextStepId` resumes
      as `start-next-boundary`.
- [ ] A run with a recorded step attempt and no committed boundary effect for
      that attempt resumes as `replay-last-boundary`.
- [ ] A committed non-terminal boundary durably completes exactly one attempt,
      persists exactly one outcome row for that attempt, and advances
      `runs.next_step_id` exactly once.
- [ ] A repeat `commitStepBoundary` call for the same already committed attempt
      returns the existing durable boundary snapshot and does not create a
      second outcome row or a second checkpoint advance.
- [ ] A committed terminal boundary leaves the run in a terminal status with
      `runs.next_step_id` absent, and later resume reads return `run-terminal`.
- [ ] Public tests prove the duplicate-commit contract through observable store
      behavior, not just by counting rows: the second call returns the same
      durable boundary snapshot the first commit produced.
- [ ] Recovery and duplicate-commit tests run through the public store API
      against temporary SQLite databases under `v2/src/*.test.ts`; they do not
      depend on daemon lifecycle code, IPC, worktrees, or step execution.
- [ ] If this slice makes recovery or terminal-run encoding more concrete than
      the current durable docs, `v2/docs/v2-architecture.md` is updated in the
      same subspec, with `v2/docs/v2-build-order.md` or `v2/spec/v2-meta-index.md`
      touched only where wording is no longer accurate.
- [ ] Every exported recovery-facing symbol added or changed in this slice keeps
      inline doc-comments aligned with the durable semantics.

## Documentation updates

- Update `v2/docs/v2-architecture.md` in this subspec if needed to pin terminal
  encoding or duplicate-commit semantics to the implemented public contract.
- Do not create a standalone docs-only subspec unless the implementation stops
  being atomic.
