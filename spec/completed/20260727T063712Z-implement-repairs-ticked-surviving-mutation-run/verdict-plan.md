## Verdict — refinement required

The spec's two-subspec split is sound; no seam change is required. The following gaps must be closed before this is implementable.

### Subspec 00

1. **Admission set vs. the resolver it delegates to.** The spec states admission is decided by the existing review-mutation resume resolver *and* that only `surviving_mutation_failed` qualifies. Those are not the same set — the resolver's resumable-outcome set also includes `ready_gate_failed` and `completion_commit_failed`. The spec must say which it means and, if it narrows, own the consequence: the admitted tail can itself settle `ready_gate_failed`, at which point a second `jarvis run workflow implement` on the same spec refuses again and the "one invocation covers repair through publication" promise fails on the retry. Either widen admission to the resolver's set (gating the agent-bearing *repair* on `surviving_mutation_failed` specifically) or record the narrowing and the stranding it leaves, with the operator's remedy.

2. **Lineage resolution must be expressed in durable-state terms.** "Latest workflow invocation for that project+branch whose write step's `specPath` is the requested spec" is invocation vocabulary the state store does not carry; lookups are per `(project, branch, stepId)`, and review step ids vary with review-pass count. State how the owning row is actually located and how the requested spec is matched against it.

3. **Drop the unreachable refusal case.** "An invocation superseded by a later one for the same spec" is not independently reachable — a later invocation's row *is* the latest, so that shape collapses into the spec-mismatch or outcome-kind guards. Remove it or restate it as the guard that actually exists, and split the remaining bundled refusal AC so each guard has its own criterion (the guard-inversion requirement applies per guard).

4. **Define "retained worktree/branch."** No existing code performs this check, so it is new behavior: state observably what is checked (worktree path present? branch resolves? claim state?) and what the operator sees when it fails.

5. **Branch resolution for admission, and a distinguishable refusal.** Branch defaults to the spec-dir basename; a lineage created under an explicit `--branch` will miss the lookup and produce the existing "no unchecked criteria" refusal text, which misdescribes the situation. State how the branch is resolved for admission and add an acceptance outcome distinguishing *genuinely complete* from *no admissible lineage found*.

6. **Name the dispatch.** "Dispatches that owning row's finalization tail" from inside connected dispatch names no request verb or payload. Given that workflow step fields cross daemon IPC as JSON (functions are silently dropped — the PR #1846 failure class) and that `01` requires implement-role bindings to reach that tail, the request shape and what crosses it must be stated.

7. **Concurrency.** Recovery deliberately skips stale-workspace reset, which is also where the `worktree_claimed` refusal lives today. Add a decision and acceptance outcome for recovery attempted against a branch with a live run.

8. **Acknowledge the conditional guarding completion validation.** Completion validation is currently skipped under some dependency shapes (`implement-workflow-steps.ts:375`). `00` restructures exactly that path into a deferred refusal and asserts ordering guarantees over it; one decision line must say what happens to that conditional.

9. **Cross-subspec sequencing.** `00`'s criterion "re-verification kills the mutation" is only reachable with a hand-fixed worktree until `01` lands. Say so in `00` and note the ordering in `index.md`.

### Subspec 01

10. **Budget composition and worst case.** Ready-gate repair already loops to its own bound. State how the mutation-repair budget composes with it and what the worst-case total agent iteration count is.

11. **Repair execution parameters.** A recovery path that bypasses workflow `start` also bypasses step preparation, where timeouts and iteration bounds are applied. State where the repair iteration's timeout, agent bindings, and iteration decoration come from, and whether re-verification after a repair is scoped to the affected surface or full.

12. **`mutation_repair_exhausted` needs its complete mapping.** A new terminal outcome must land with its retryability, `run resume` behavior, `run list`/`wait` reporting, and next-action string — not just the settle. Relatedly, the existing operator-error guidance directs operators to `jarvis run resume` on `surviving_mutation_failed`; after this spec that string points at the weaker, agent-free path. Updating it belongs in `01`'s tasks and docs.

13. **Name the settling outcome for a blocked or unsettled repair iteration.** "Stops the tail without publishing" leaves retryability undefined; state which outcome it settles as. Also state how `--detach` interacts with the recovery dispatch.

### Trim

`00` carries four documentation surfaces; fold the daemon-host material into the workflow-runner update unless the daemon-side contract is separately operator-facing.

### Rationale

Items 1, 2, 4, and 5 are the difference between a spec that can be implemented as written and one whose central guard is undefined — admission is this spec's entire contract. Items 3, 12, and 13 are required by the repo's guard-inversion and behavior-mapping conventions: every guard needs its own negative case, and a new terminal outcome that lacks a next-action mapping strands the operator exactly where the intent says it should not. Items 6 and 11 target known failure modes in this codebase (silent IPC drops, undecorated steps) that this design walks directly into. Item 1 is the one that can defeat the intent's headline promise even when everything else is correct.