# Reconcile done token against unticked criteria

## Problem

An implement iteration that returns `done` is committed as `outcomeKind: done` /
`runStatus: completed` on the agent's word alone: `executeDefaultWrite`
(`v2/src/execution/write.ts`) declares only an `artifact.exists` contract, so the
boundary commits and the completion commit publishes before anything reads the spec.
Run `f9d556ed` (2026-07-13) recorded `boundary_committed: done` on a subspec with 0 of
5 criteria ticked.

`runLinkedImplementStep` does re-verify criteria
(`v2/src/execution/workflow-runner.ts:447`, `implement.link_incomplete`), but only
*after* the write loop returned `complete` — the `done` boundary and the completion
commit are already durable at that point. The check must move to the boundary, where
`contract_miss` already exists as the "terminal token, deterministic post-check failed"
outcome and stops the loop before publish.

## Decisions

- Implement write steps carry a second step contract (`spec.criteria-ticked`) alongside `artifact.exists`; rules out downgrading the outcome after the fact in `runLinkedImplementStep`, which cannot un-commit the boundary or the completion commit.
- The contract re-reads the active subspec (the write step's `expectedArtifactPath`) from the run's worktree; rules out trusting the agent's terminal token or any in-memory copy of the spec.
- Criteria come from `parseSpec` in `shared/spec-parser.ts`; a criterion blocks completion iff `!humanOnly && !checked`. Rules out a second parser and re-deriving the human-only markers.
- The contract is scoped to implement writes (`patch.prompt.body`); rules out firing on plan-draft / intent-split / review-revision writes, whose artifacts are not criteria-bearing subspecs.
- `contract_miss` appends its `## Blocker` to the file the contract concerns — the active subspec — not to `args.specPath`, which for linked-index implement runs is `index.md`. Rules out the harness writing Blocker sections into the routing index it owns.
- The failure reason enumerates the unticked criteria; rules out a bare contract id the operator has to diff the spec to interpret.
- `runLinkedImplementStep`'s existing `implement.link_incomplete` check stays as an unreachable-in-practice backstop; removing it is not part of this change.

## Acceptance criteria

- [ ] An implement iteration whose agent returns `done` (or `no-work`) while the active subspec has ≥1 unticked non-human-only acceptance criterion records `outcomeKind: "contract_miss"` / `runStatus: "blocked"` — never `done` / `completed` — and no completion commit, draft PR, or ready-finalize runs for that boundary.
- [ ] The verdict is taken from the subspec re-read from the run's worktree at the boundary, using `parseSpec` / `humanOnly` from `shared/spec-parser.ts`.
- [ ] A `done` iteration whose subspec has every non-human-only criterion ticked completes as before, even with unticked human-only criteria.
- [ ] The `## Blocker` written on a `spec.criteria-ticked` miss lands in the active subspec (not `index.md`) and names each unticked criterion.
- [ ] The contract does not fire on plan-draft, intent-split, or review-revision write steps.
- [ ] `v2/src/execution/workflow-runner.test.ts` and `v2/src/execution/write-loop.test.ts` stay green (linked-index routing and boundary ordering unchanged).

## Documentation updates

- `v2/docs/write-behavior.md` § Loop outcomes — `done` / `no-work` now checks the criteria contract in addition to `--artifact` existence; name the Blocker target for linked implement runs.
- `v2/docs/v1-behaviors.md` — v1's completion contract (complete = zero unchecked items) is now enforced on v2 implement boundaries.
- `v2/docs/operator-runbook.md` § Gate trust — a `completed` v2 implement run implies the active subspec's non-human-only criteria are ticked.
