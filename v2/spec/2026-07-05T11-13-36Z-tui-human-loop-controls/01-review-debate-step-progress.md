# 01 - Review-debate step progress in run rows

`review-debate` steps are entirely excluded from the workflow snapshot today:
`executeWorkflow` filters them out before building `snapshotSteps`
(`v2/src/execution/workflow-runner.ts:294`, `steps.filter((step) => step.behavior !== "review-debate")`),
so a `review-debate` step never appears in `DaemonWorkflowSnapshot.steps` and the
TUI run monitor shows nothing for it — unlike `write` steps, which render as a
`stepId role status` line via `monitorTextLines` (`v2/src/tui/tui-monitor-lines.ts`).
`executeReviewDebate` (`v2/src/execution/review-debate.ts`) already invokes each
of the four fixed roles (`adversary`, `advocate`, `adjudicator`, `actuator`) in
order and records terminal `roleResults`, but nothing observes which role is
currently running mid-cycle, and there is no durable per-role run row (a
`review-debate` step has no durable run/resume in this slice per the existing
comment at `workflow-runner.ts:465`).

## Decisions

- A `review-debate` step gets one row in `DaemonWorkflowSnapshot.steps`, keyed by
  its `stepId` (matching how a `write` step's row works today) — not one row per role.
- While the cycle is running, that row's `role` reflects the currently-executing
  debate role (`adversary` → `advocate` → `adjudicator` → `actuator`) and `status`
  is `in_progress`; on completion/stop it holds the terminal role and outcome,
  matching the existing `status`/`terminalOutcome` vocabulary used for `write` steps.
- Tracked in-memory only (no new durable per-role run rows), consistent with the
  existing "no durable run/resume for a review-debate step" boundary — the daemon's
  existing in-memory `activeRuns`-style liveness tracking is the natural home for
  the current-role pointer, not the state store.
- Deferred to first consumer: exact resume/replay semantics for a `review-debate`
  step interrupted mid-cycle — pin when a caller needs it.
- The live-role pointer is cycle-agnostic: `executeReviewDebate` may loop through
  the four roles across multiple cycles, and the row always reflects the
  current/latest cycle's role — a role reappearing after `actuator` (next cycle
  restarting at `adversary`) is expected, not a stuck or reset row.

## Task Checklist

- [ ] Stop filtering `review-debate` steps out of `snapshotSteps` in
      `executeWorkflow` (`workflow-runner.ts`).
- [ ] Give `runReviewDebateStep` a way to report the currently-executing role as it
      progresses (e.g. an observer/callback into `executeReviewDebate`'s per-role
      invocation loop), and expose that pointer to the daemon's `list` handler.
- [ ] Extend `workflowStepSnapshot`/`workflowRowSnapshot` (`v2/src/daemon/daemon.ts`)
      to build a step row for a `review-debate` step from that live pointer plus
      terminal `roleResults` once the cycle ends.
- [ ] Add a `review-debate.test.ts` case asserting the live-role pointer/callback fires
      with each role in order (`adversary`→`advocate`→`adjudicator`→`actuator`) as
      `executeReviewDebate` progresses, including across a second cycle.
- [ ] Add a `daemon.test.ts` (or equivalent) case asserting `workflowStepSnapshot`/
      `workflowRowSnapshot` builds a `review-debate` row from the live pointer while
      in progress, and from terminal `roleResults` once the cycle ends.

## Acceptance criteria

- [x] `jarvis tui` run rows show a step line for an in-progress `review-debate` step
      whose `role` updates as the cycle advances through `adversary`/`advocate`/`adjudicator`/`actuator`.
- [x] Once the cycle completes or stops, the row's `status`/`terminalOutcome` matches
      the same vocabulary (`completed`/`complete`, or a stop outcome) already used
      for `write` steps.
- [x] New `review-debate.test.ts` coverage exercises the live-role pointer advancing
      through a full cycle (and into a second cycle), and new daemon-side test coverage
      exercises building a `review-debate` row from both the live pointer and terminal
      `roleResults`.
- [x] `review-debate.test.ts` and `workflow-runner.test.ts` existing suites stay green
      (no behavior change to the debate cycle itself, only observability).

## Documentation updates

- Update `v2/docs/v2-architecture.md`'s review-debate section (around the existing
  adversary→advocate→adjudicator→actuator description) to note the cycle now
  surfaces live per-role progress through the daemon `list`/TUI snapshot.
