# Blocked outcome persists blocker text onto the run

## Problem

A genuine `blocked` outcome records `outcomeKind: "blocked"` but persists no blocker
text: the agent's `## Blocker` body lives only in the spec file inside the worktree.
When the worktree copy does not survive (or was never written), the operator sees
`boundary_committed(blocked)` → `loop_finished(blocked)` with nothing to act on.
`Attempt`/`Run` in `state-store.ts` carry no blocker-text field, and a plain `blocked`
outcome emits neither `blocker_reprompt` nor `missing_blocker_detail`.

The blocker-text contract (`resolveBlockedResult`, step-runner.ts) already reads the
post-run spec and confirms a genuine `## Blocker` via `hasGenuineBlocker`; the body is
extractable there with `extractBlockerBody` (shared/spec-parser.ts). Capture it and
persist it durably.

## Decisions

- Capture the agent's `## Blocker` body when the blocker-text contract is satisfied and emit it as a durable run-log record on the blocked path (as `missing_blocker_detail` already does for the defect path). Rules out leaving the text only in the worktree spec, which may not survive.
- The blocker text must be retrievable from durable run state without reading the worktree spec copy. Rules out "the text is in the spec, go read it."
- Truncate the persisted blocker text through the existing log-text truncation used for the other blocker/reprompt detail records. Rules out unbounded log rows.

## Task checklist

- [ ] Extract the appended `## Blocker` body at the contract-satisfied seam and thread it to the write-loop terminal handling.
- [ ] Persist it as a durable run-log record on the blocked path.
- [ ] Add the failing regression test.
- [ ] Update docs.

## Acceptance criteria

- [x] A new regression test drives a write step to a genuine `blocked` outcome (agent appends a non-empty `## Blocker`) and asserts the agent's blocker body is retrievable from the durable run log without reading the worktree spec file; it fails against the pre-fix code.
- [x] A `blocked` outcome whose `## Blocker` body is empty does not emit a blocker-text record (it is the `missing_blocker` defect path from subspec 00), verified by a test.
- [x] Persisted blocker text is truncated by the same log-text truncation applied to `missing_blocker_detail` / `blocker_reprompt`, verified by a test with over-long blocker text.

## Documentation updates

- `v2/docs/operator-runbook.md` — where the blocker text appears in a blocked run's report / `run log`, reachable without the worktree.
- `v2/docs/v1-behaviors.md` — record that a blocked outcome persists the agent's `## Blocker` body onto the run.
