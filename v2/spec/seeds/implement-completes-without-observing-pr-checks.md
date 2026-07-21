# Implement reports `completed` while its PR shows failing checks

## Problem

A v2 implement run reporting `runStatus: "completed"` certifies only *local* evidence: ticked
criteria, a completion commit, PR evidence, a green **local** ready gate, mutation and smoke
verification. Nothing in `v2/src` or `shared/` ever reads the PR's remote check status —
`grep -rn "statusCheckRollup\|gh pr checks" v2/src shared` returns nothing.

So a run completes, flips the PR draft → ready, and the operator opens a PR with red CI. Observed
2026-07-20: "implement is creating drafts with failing checks. runs are labeled complete but if I
see a PR in that state, that's not what I would expect."

Local-green / CI-red is structurally reachable: the local gate is base-scoped
(`JARVIS_READY_TEST_SCOPE` from a three-dot diff) while CI scopes by changed path
(`scripts/ci-test-scope.ts`), and the two run on different machines and checkouts.

## Decisions

- After ready finalization, observe the PR's remote check status before reporting `completed`;
  a run whose PR has failing required checks must not report `completed`.
- Reuse the existing bounded repair path (`publishWithReadyRepair`) rather than adding a new
  gate concept: a red remote check is handed back like a red local gate.
- Bound the wait: pending checks are polled to a deadline, then reported as an unresolved
  check state, not silently treated as green. Pin the deadline value in the plan.
- Rules out blocking completion on non-required or informational checks.
- Deferred to first consumer: re-observing checks after an operator pushes a manual fix.

## Acceptance criteria

- [ ] An implement run whose PR has a failing required check does not report `runStatus: "completed"`;
      its terminal state names the failing check.
- [ ] The failing-check state is retryable and `jarvis run list` / `wait` report an actionable
      `nextAction`.
- [ ] Pending checks are polled to a bounded deadline; exceeding it reports an unresolved check
      state rather than completing.
- [ ] All-green required checks complete exactly as today.
- [ ] Non-required / informational checks do not block completion.
- [ ] Regression coverage exercises green, red, and pending rollups through an injected `gh` seam.
- [ ] `bun run typecheck`, `test:v2`, `test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — completion now implies observed PR checks.
- `v2/docs/workflow-runner.md` — remote check observation at finalization.
- `v2/docs/v1-behaviors.md` — record the changed v2 completion contract.
