# A terminal `killed` row permanently blocks worktree retirement and spec archival

## Problem

`jarvis cleanup` can never retire a worktree whose `(project, branch)` has a `killed` durable run,
even when that run is long dead and the branch's PR is merged. `killed` is a **terminal** status, so
the condition never clears: the worktree is ineligible forever, and because a materialized worktree
owns the spec, the spec is unarchivable forever.

Observed 2026-07-26 on `20260726T061435Z-aggregate-test-cost-is-measured-per-file`:

- PR #2177 **merged** 2026-07-26T14:07:19Z.
- Durable rows for the branch: four `completed`, plus one `killed`
  (`0da703c9`, `unsupported_resume_context`) left by a dispatch against a daemon that later needed a
  bounce.
- The operator ran `jarvis cleanup` **twice**; both times the spec stayed in the open home.
  `--dry-run` reports:

```text
Skipped stranded artifact: …/v2/spec/20260726T061435Z-aggregate-test-cost-is-measured-per-file
  — another materialized worktree owns this spec
No eligible worktrees or stranded artifacts to clean up.
```

The archival refusal names the *worktree*, which is the downstream symptom. The upstream cause is the
eligibility gate: it requires "no `in-progress`, `paused`, `queued`, `budget-soft-stopped`, or
`killed` run for the `(project, branch)`". The first four are non-terminal and legitimately mean work
may be in flight. `killed` is terminal and means the opposite — nothing is running and nothing will.

This is **not** the two-invocation ordering defect in
`cleanup-scans-stranded-specs-before-retiring-worktrees`. That one resolves on a second cleanup; this
one resolves on no number of cleanups. They were initially conflated; the double-cleanup evidence is
what separates them.

Blast radius: every branch that ever had a run killed — including every row settled `killed` /
`daemon_restart` by startup reconciliation, which is the harness's *normal* recovery path after a
daemon bounce. Any spec implemented on such a branch is permanently unarchivable.

Manual escape hatch today: `jarvis cleanup --abandon <name>` (its PR gates pass, since a merged PR
leaves zero *open* PRs). That is a per-branch operator action for what should be automatic.

## Decisions

- A terminal `killed` row must not block retirement. The gate's purpose is to protect in-flight work;
  a killed run has none. Rules out the current membership of `killed` in the blocking set.
- Liveness is still checked independently — the daemon's live-run probe and the `.jarvis.lock`
  check are unchanged, and either one still refuses. Rules out reading this as "stop checking whether
  a run is live"; the durable-status check is a second, weaker signal and it is the one that is wrong.
- Verify no other terminal status is in the blocking set for the same reason. `killed` is the one
  observed; the fix should state the rule (terminal statuses do not block) rather than special-case
  one value.
- Fail-closed behavior on `gh` failure, daemon unreachability, or store errors is unchanged.
- The archival refusal should name the *reason the owning worktree was not retired*, not only that an
  owner exists — the current message sends the operator to the wrong defect. Rules out fixing the gate
  while leaving the message that misattributed it.
- Out of scope: the retirement-vs-archival ordering defect (owned by
  `cleanup-scans-stranded-specs-before-retiring-worktrees`).

## Acceptance criteria

- [ ] A worktree whose branch has a terminal `killed` run and a merged PR is eligible for retirement;
      a test asserts eligibility and fails against the pre-fix gate.
- [ ] A worktree whose branch has a non-terminal run (`in-progress`, `paused`, `queued`,
      `budget-soft-stopped`) is still ineligible; a test covers each and inverting the terminal check
      fails them.
- [ ] A live daemon run for the `(project, branch)` still refuses retirement even when every durable
      row is terminal; a test asserts the liveness probe is independent of durable status.
- [ ] A `.jarvis.lock`-held worktree still refuses.
- [ ] Retiring such a worktree then archives its completed spec in the same invocation; a test drives
      the merged-PR-plus-killed-row case end to end and asserts the spec lands in `completed/`.
- [ ] An archival refusal caused by an unretired owner names why that owner was not retired; a test
      asserts the reason appears in the message.
- [ ] Fail-closed paths (`gh` error, daemon unreachable, store error) still mark ineligible; existing
      tests stay green.

## Documentation updates

- `v2/docs/operator-runbook.md` — § Cleanup: eligibility gate: correct the blocking-status list to
  non-terminal statuses only, and record that `--abandon` was the workaround before this shipped.
