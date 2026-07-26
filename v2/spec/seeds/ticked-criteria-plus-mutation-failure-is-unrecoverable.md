---
name: ticked-criteria-plus-mutation-failure-is-unrecoverable
---

# A mutation failure over ticked criteria has no jarvis-native recovery

## Problem

When an implement run settles `surviving_mutation_failed` *after* its agent ticked every acceptance
criterion, both recovery paths are closed at once:

- `jarvis run resume` refuses the owning `implement-review` row
  (`resume_unsupported`; see [[resume-refuses-the-review-row-it-advertises]]).
- `jarvis run workflow implement` exits `1` with `implement.already_complete`, because preflight
  reads the spec tree and finds no unchecked non-human-only work.

The run is complete by the spec's own account and incomplete by the harness's. Nothing in the CLI
moves it forward. The operator's only exits are hand-editing the branch or untick-and-replay, which
throws away a green write step.

Observed 2026-07-26 on `20260726T205113Z-claim-refusal-precedes-stale-workspace-retirement`.
Recovery was: write the missing test by hand in the run's worktree, verify the mutation dies,
commit, push, flip the draft PR, merge. None of that is a jarvis command.

## Why it recurs

Mutation verification is diff-derived and runs *after* the criteria gate. So the two gates can
disagree by construction: criteria say "the work is described and done," mutation says "a changed
guard is uncovered." Neither is wrong. There is just no state that represents "complete but
under-covered," and no command that advances it.

## Decisions

- The harness owns a forward path from `surviving_mutation_failed` that does not require unticking
  criteria or hand-editing. Rules out documenting the manual sequence as the answer.
- Prefer repairing in place over replay: the write step is green and its output is on the branch.
  Rules out treating this as a full re-dispatch.
- Fixing [[resume-refuses-the-review-row-it-advertises]] is necessary but not sufficient — resume
  only helps once coverage is fixed. Something must let the agent *fix the coverage*: either a
  bounded repair iteration for a surviving mutation (as the ready gate already has), or an
  `implement` preflight that admits a run whose criteria are ticked but whose last row failed
  verification. Rules out closing this seed by fixing resume alone.
- `implement.already_complete` must not be reachable while the same spec's latest run is a
  non-terminal-success verification failure. Rules out preflight consulting only the spec tree.

## Acceptance criteria

- [ ] A spec whose criteria are all ticked and whose latest run settled
      `surviving_mutation_failed` is advanced by a single jarvis command; a test drives that state
      and asserts a non-`already_complete` outcome. Fails against current preflight.
- [ ] That path repairs coverage without re-invoking the completed write step's agent and without
      unticking criteria; a test asserts both.
- [ ] After repair, mutation re-verification, the ready gate, and publication run, and the run
      settles `completed`.
- [ ] A spec with genuinely complete work and no failed verification still exits
      `implement.already_complete`; existing preflight coverage stays green.
- [ ] A repair that fails to kill the mutation settles a named terminal failure rather than
      looping; the iteration budget is bounded and asserted.
- [ ] Inverting the preflight admission condition turns the first test RED.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — the recovery for `surviving_mutation_failed` over
  ticked criteria; remove the implication that resume alone covers it.
- `v2/docs/workflow-runner.md` — preflight's `already_complete` rule and its verification-failure
  exception.
