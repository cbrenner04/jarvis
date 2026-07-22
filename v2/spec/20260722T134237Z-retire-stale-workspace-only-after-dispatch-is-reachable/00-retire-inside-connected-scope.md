# 00 - Retire inside the connected dispatch scope

## Problem

`runWorkflowCommand` (`v2/src/commands/workflow.ts:218`) calls `maybeResetStaleWorkspace` before
`withConnectDispatch`. Stale-workspace retirement — draft-PR closure, worktree removal, local and
remote branch deletion — therefore completes before the invocation is known to reach dispatch. Any
refusal on the dispatch side (connect failure, daemon auto-start failure, any future guard at that
seam) lands after the prior attempt's work is already destroyed. Observed 2026-07-21: PR #1911
closed, worktree removed, both refs deleted, no run dispatched.

## Decisions

- Move the `maybeResetStaleWorkspace` call inside the `withConnectDispatch` dispatch callback, ahead
  of `startWorkflowRun`. Rules out reordering the connect check ahead of one named guard, which
  leaves every other post-retirement refusal path with the same defect.
- A retirement refusal returns `1` from inside the dispatch callback without issuing `start`. Rules
  out treating a connected client as license to start a run whose workspace could not be reset.
- Keep the `daemonClient` argument to `resetStaleWorkspace` the stub `async () => []` even though a
  live client is now in scope. Rules out widening this change into a liveness-gate improvement;
  wiring real daemon liveness into the reset gate is separate behavior.
- Retirement stdout (`Retired: <path>`) still precedes the run-id line, so operator-visible stdout
  ordering is unchanged.

## Task checklist

- [ ] Move the retirement call into the dispatch callback in `runWorkflowCommand`.
- [ ] Add regression coverage in `v2/src/commands/workflow.test.ts` driving a dispatch-unreachable
      `run workflow implement` against a populated stale workspace.
- [ ] Update `v2/docs/operator-runbook.md` and `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [ ] A new test in `v2/src/commands/workflow.test.ts` drives `run workflow implement` against a
      materialized stale worktree with dispatch unreachable (connect fails and daemon start fails),
      and asserts no `gh pr close`, no worktree removal, and both local and remote branch refs
      survive; it fails against the pre-fix ordering and passes after the change.
- [ ] Inverting the added ordering guard (retiring before the connect instead of inside the
      connected scope) makes that test fail.
- [ ] Existing `implement preflight stale workspace reset` tests in
      `v2/src/commands/workflow.test.ts` stay green: the happy path still retires and then dispatches
      with unchanged stdout, the live-held case still exits `1` without starting a run, and a fresh
      run still performs no teardown.
- [ ] `v2/docs/operator-runbook.md` § implement workflow states retirement runs only after the
      invocation is known dispatchable.
- [ ] `v2/docs/v1-behaviors.md` records the changed preflight ordering on the existing implement
      re-run reset entry.
- [ ] `bun run typecheck`, `bun run test:v2`, `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — the incomplete-re-run retirement paragraph (~line 206): retirement
  happens after the daemon connection is established, not before daemon contact.
- `v2/docs/v1-behaviors.md` — the `[v2 additive]` implement re-run reset entry (~line 76): reset runs
  after a successful step build **and** after the daemon connect, before `start`.
