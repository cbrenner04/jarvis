# Admit fan-out branches with destination ownership

## Problem

- Approved sibling branches can claim their completed predecessor's worktree instead of their distinct destination worktrees, causing timing-dependent `worktree_claimed` failures.

## Prerequisites

- `pipeline-execution.ts` persists branch-keyed stage rows and scopes approval continuation to the approved branch.
- `pipeline-stage-resolve.ts` reads chained inputs from the preceding artifact and entry-run worktree.
- `daemon.ts` distinguishes workflow-start refusal before entry-run creation from admission after an entry run exists.

## Decisions

- A completed predecessor worktree is a read-only chained-input root, never a successor ownership key.
- Each sibling dispatch owns only its resolved destination `(project, branch)` worktree; neither destination may equal the predecessor worktree. This is an invariant the resolution change establishes, not a runtime condition to be reached — express it as a pure predicate over ownership keys, not as a defensive branch inside dispatch.
- Workflow-start admission returns the durable entry-run ID before stage lifecycle handling. `workflowInvocationId` stores that entry-run ID, not workflow-wide `workflowSnapshot.invocationId` metadata.
- A deterministic admission barrier holds both siblings at the ownership/admission boundary, then releases both; neither may settle before both arrive.
- A refusal before entry-run admission records `failed` with no `startedAt` or `workflowInvocationId` and never waits. This is pre-admission dispatch-seam coverage, not real-admission coverage.
- No destination-worktree retry/backoff mechanism exists in the current stage-dispatch seam; this slice adds none. `multiple_failed_stages` resume behavior remains pinned separately.

## Tasks

- Separate chained predecessor input access from destination workflow ownership during fan-out resolution and dispatch.
- Return the admitted entry-run ID to the stage dispatcher before any failure path can classify the dispatch.
- Add a real-resolution, real-workflow-start sibling regression with a deterministic admission barrier and distinct destination identities.
- Convert the focused pre-admission refusal case to assert its durable stage row; retain no-wait behavior.
- Prove each guard by its applicable form: a killing mutation directive where the failure state is reachable, an exported pure predicate tested both directions where the fix makes it unreachable.
- Keep `// @mutate` directives in the pinning test files only; production source carries no marker comment.

## Acceptance criteria

- [ ] `daemon-pipeline-approval.test.ts` — `concurrent approved sibling branches own destination worktrees` drives both branches through the real stage resolver and default workflow-start admission. Its barrier observes both siblings at the ownership/admission boundary before release; while held, each predecessor artifact is read-only input, each admitted entry run has a distinct destination ownership identity, neither destination resolves to the predecessor worktree, and both durable branch rows become exactly `running`. The regression fails against the baseline.
- [ ] `pipeline-stage-dispatch.test.ts` — `pre-run dispatch refusal leaves the stage failed and unlinked` uses a durable `StateStore` row and a genuine `ok: false` pre-admission dispatch result to prove `failed`, null `startedAt`, and null `workflowInvocationId`, with no wait call. It is labeled pre-admission seam coverage and does not stand in for the real-admission regression.
- [ ] `pipeline-execution.test.ts` — `returns reopen refusal for ineligible failed shapes without stage dispatch` stays green, preserving `multiple_failed_stages` resume refusal. No criterion claims a destination-worktree retry/backoff preservation because no such current mechanism or pinning test exists.
- [ ] Every added or changed guard is proven in exactly one of two forms, and none is left unproven: **(a) reachable** — its failure state can be produced through the real dispatch seam, so it carries one uniquely applicable single-line `// @mutate` directive in `daemon-pipeline-approval.test.ts` or `pipeline-stage-dispatch.test.ts` that turns that named test RED when applied independently; **(b) invariant** — the fix makes its failure state unreachable end to end, so its decision is an exported pure predicate with a direct unit test asserting both truth directions. No production inversion hook, and no marker comment in production source.
- [ ] A guard that fits neither form is deleted, not retained unproven; the positive regressions above carry the proof instead. The destination-vs-predecessor ownership comparison is form (b) — an exported predicate tested in both directions, since after this fix no real resolution yields a destination equal to its predecessor.
- [ ] The already-`running` sibling skip guard is either proven under form (a) by a re-entry regression that seeds a `running` durable stage row before advancing fan-out resolution and proves that branch is not re-dispatched, or removed under the rule above.

## Documentation updates

- None; lifecycle documentation is owned by `01-preserve-admitted-stage-linkage-through-settlement.md`.
