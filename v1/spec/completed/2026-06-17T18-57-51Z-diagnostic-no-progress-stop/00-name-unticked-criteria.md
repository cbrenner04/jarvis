# Name unticked criteria on no-progress stop

## Problem

When a patch iteration runs clean (`result.kind === "ok"`) but ticks no
acceptance criterion and the unchecked count is unchanged, the run stops with
the generic `iteration N made no progress; stopping` and exit `4`. If the work
is in fact done-but-unticked, the operator gets no pointer and must read the
spec and diff to recover the stall.

The dirty-worktree stop (exit `6`) already lists unmet criteria and points at
ticking them; the clean no-progress stop does not.

## Reachability

The diagnostic fires only when the index links an unchecked subspec (so an
active subspec is resolvable) AND the worktree is clean. A dirty tree diverts
to the dirty-worktree stop (exit `6`) first; the clean exit-4 case arises under
`git: false`, work already committed by a prior iteration, or an otherwise clean
tree. The index unchecked-count and the subspec acceptance criteria are
separate surfaces: the count can be unchanged while the named criteria stay
unticked.

## Decisions

- Diagnostic fires only on the clean-run-but-no-tick no-progress path
  (`v1/src/modes/patch/run.ts`, the `after === before && !subspecCompleted &&
  !subspecProgressed` branch). Not the lenient-quota or error no-progress
  branches, which own their messaging.
- Fires only when an active subspec is resolvable. Top-level checklist runs
  with no linked subspec have no acceptance criteria to name and keep the
  generic line — rules out printing an empty/crashing criteria list.
- Named criteria come from the same after-iteration acceptance-criteria
  snapshot the harness already computes for the active subspec
  (`snapshotAcceptanceCriteria(afterSubspecPath)`) — rules out re-deriving
  criteria from a separate read.
- The criteria block lands after the stop sentence, blank-line separated,
  matching the dirty-worktree stop — rules out interleaving with the bounded
  tail of agent output the path prints before the stop line.
- Stop output keeps the `made no progress; stopping` substring. Operators grep
  for it — rules out replacing the wording wholesale.

## Tasks

- On the clean no-progress stop, when the active subspec is resolvable, print
  after the stop sentence (blank-line separated) its unticked acceptance
  criteria and a one-line operator pointer containing the greppable substring
  `tick the satisfied acceptance criteria` to recover if the work is done.
- Source the named criteria from the after-iteration snapshot the harness
  already computes for the active subspec.
- Keep exit code `4` and the `made no progress; stopping` substring.
- Leave the top-level-checklist no-progress stop (no active subspec) on the
  current generic line.
- Add a test exercising the linked-subspec clean no-progress state; existing
  no-progress tests all use a bare top-level task and never reach this branch.
- Update the docs listed below.

## Acceptance criteria

- [x] On a clean patch iteration with a resolvable active subspec that ticks no acceptance criterion and leaves the unchecked count unchanged, the no-progress stop output names each unticked acceptance criterion of the active subspec.
- [x] The same stop output contains the substring `tick the satisfied acceptance criteria` pointing the operator to recover if the work is already done.
- [x] The named criteria block follows the `made no progress; stopping` sentence, separated by a blank line.
- [x] The no-progress stop still exits `4`.
- [x] The no-progress stop output still contains the text `made no progress; stopping`.
- [x] A clean no-progress stop on a run with no resolvable active subspec keeps the generic message and names no criteria.
- [x] The lenient-quota, agent-error, and dirty-worktree stop paths are unchanged.

## Out of scope

- Hardening the agent to always tick satisfied criteria (the "agent failed to
  tick" half) lives in a sibling intent; this spec covers only the
  operator-recovery half ("operator must tick to recover"). The rules-hardening
  lever is out of scope here.

## Documentation updates

- `v1/docs/run-loop.md`: describe the no-progress stop, the done-but-unticked recovery (tick the named criteria), and the changed stop-message wording.
- `v2/docs/v1-behaviors.md`: add a net-new entry recording that the no-progress stop names the active subspec's unticked criteria on the clean-run-but-no-tick path (the existing catalog maps only the exit code).
