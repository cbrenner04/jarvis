# Name unticked criteria on no-progress stop

## Problem

When a patch iteration runs clean (`result.kind === "ok"`) but ticks no
acceptance criterion and the unchecked count is unchanged, the run stops with
the generic `iteration N made no progress; stopping` and exit `4`. If the work
is in fact done-but-unticked, the operator gets no pointer and must read the
spec and diff to recover the stall.

The dirty-worktree stop (exit `6`) already lists unmet criteria and points at
ticking them; the clean no-progress stop does not.

## Decisions

- Diagnostic fires only on the clean-run-but-no-tick no-progress path
  (`v1/src/modes/patch/run.ts`, the `after === before && !subspecCompleted &&
  !subspecProgressed` branch). Not the lenient-quota or error no-progress
  branches, which own their messaging.
- Fires only when an active subspec is resolvable. Top-level checklist runs
  with no linked subspec have no acceptance criteria to name and keep the
  generic line — rules out printing an empty/crashing criteria list.
- Stop output keeps the `made no progress; stopping` substring. Operators and
  the existing generic-stop test grep for it — rules out replacing the wording
  wholesale.

## Tasks

- On the clean no-progress stop, when the active subspec is resolvable, append
  its unticked acceptance criteria and a one-line pointer telling the operator
  to tick them if the work is done.
- Keep exit code `4` and the `made no progress; stopping` substring.
- Leave the top-level-checklist no-progress stop (no active subspec) on the
  current generic line.
- Update the docs listed below.

## Acceptance criteria

- [ ] On a clean patch iteration that ticks no acceptance criterion and leaves the unchecked count unchanged, the no-progress stop output names each unticked acceptance criterion of the active subspec.
- [ ] The same stop output points the operator at ticking those criteria if the work is already done.
- [ ] The no-progress stop still exits `4`.
- [ ] The no-progress stop output still contains the text `made no progress; stopping`.
- [ ] A clean no-progress stop on a run with no resolvable active subspec keeps the generic message and names no criteria.
- [ ] The lenient-quota, agent-error, and dirty-worktree stop paths are unchanged.

## Documentation updates

- `v1/docs/run-loop.md`: describe the no-progress stop, the done-but-unticked recovery (tick the named criteria), and the changed stop-message wording.
- `v2/docs/v1-behaviors.md`: record the no-progress stop now names the active subspec's unticked criteria on the clean-run-but-no-tick path (existing-behavior baseline).
