# Three parallel publication tails have drifted apart in one file

## Problem

`publishWithReadyRepair` now has three call sites in `v2/src/execution/workflow-runner.ts`, each with
its own surrounding tail:

| call site | path |
| --- | --- |
| ~946 | primary `executeWorkflow` completion tail |
| ~2314 | `resumePopulatedIntentPublication` (intent-finalization resume) |
| ~2626 | `resumeReviewMutationFinalization` (review-mutation resume) |

The two resume paths exist because the primary tail is embedded inside `executeWorkflow` and driven by
live `AnyWorkflowStep` objects, while a resumed run has only a persisted workflow snapshot and a
durable run row. Rather than making the existing tail callable from snapshot state, each resume path
reimplements it: context resolution, failure settlement, commit-before-publish, publication-shape
derivation, and attempt-boundary recording.

Only the *head* is shared. `resolveReviewRowHead` and `IntentFinalizationResumeDeps` are common; the
bodies are not. That was a deliberate, narrowly-scoped review outcome ("deduplicate the resolver head
shared with the intent-finalization resolver"), not a judgment that the bodies should stay separate.

The drift is already visible. Each tail decides independently whether to commit uncommitted worktree
changes first, how to derive the PR body summary, which `specTemplate` value to pass, and which
outcome kinds it settles as resumable — and those decisions were reached at different times by
different reviews. A behavior fixed in one tail does not reach the other two.

Evidence that this compounds: during the 2026-07-25 session, an operator-facing claim about swept
partial edits had to be corrected in `v1-behaviors.md` after a PR reintroduced it, and the
intent-resume and review-resume paths each independently had to be told not to settle a row
`resumable: true` that `run resume` would then refuse. Both are the same class of bug — one tail
learning something the others do not.

## Decisions

- Extract one publication tail that both the live-step and snapshot-backed callers invoke, so
  commit-first behavior, body-summary derivation, `specTemplate` selection, settlement, and attempt
  recording have a single definition. Rules out a fourth parallel tail when the next resume path
  lands.
- The seam is the input, not the caller: the shared tail takes a resolved context (worktree, base ref,
  spec path, landing kind, completion agent, creation title) that both a live step and a persisted
  snapshot can produce. Rules out passing `AnyWorkflowStep` into the resume paths just to reuse code.
- Preserve every behavioral difference that is genuinely intentional by making it an explicit
  parameter, not an implicit divergence — and enumerate those differences in the spec before
  consolidating. Rules out a "cleanup" that silently changes one path's behavior to match another's.
- Instrument or test-pin the current behavior of all three tails first, so the consolidation is
  provably behavior-preserving where it should be. Rules out refactoring against assumed equivalence.
- Out of scope: whether resume should exist for these outcomes at all; the admission predicates.

## Acceptance criteria

- [ ] `publishWithReadyRepair` has one calling tail; a test fails if a second tail is reintroduced
      (e.g. a guard asserting the call-site count, or the shared entry being the only caller).
- [ ] Each intentional per-path difference is an explicit argument with a named default, and the spec
      lists them; a reviewer can read the call sites and see what differs without diffing bodies.
- [ ] Existing coverage for all three paths stays green with no assertion weakened: the primary
      completion tail, `resumes intent finalization from a populated stage without review
      re-invocation`, and `resuming a review row's surviving_mutation_failed actually re-runs the ready
      finalizer`.
- [ ] A behavior change made once (e.g. commit-before-publish) is observably in effect on all three
      paths, proven by a test that would fail if only one path had it.

## Documentation updates

- `v2/docs/workflow-runner.md` — one publication tail, its inputs, and how snapshot-backed resume
  reaches it.
