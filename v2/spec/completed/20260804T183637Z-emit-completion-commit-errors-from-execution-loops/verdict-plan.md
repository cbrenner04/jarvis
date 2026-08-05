## Verdict — refinements required

### 1. Cover (or explicitly exclude) workflow-runner resume settlement

The Decisions say "every terminal `completion_commit_failed` `loop_finished` append" and the intent names "repair, retry, and **resume** paths," but the Tasks only reach the three primary-tail sites in `workflow-runner.ts` (no-commit-SHA dirty ~959, committer-throw catch ~1120, publication ~1062) plus the write-loop funnel. Four further workflow-runner appends emit `completion_commit_failed` with the failure message in scope and drop it from the event:

- `settleIntentResumeFailure` (append ~2488) — reached by intent-resume committer-throw and no-commit-SHA dirty
- `settleReviewMutationResumeFailure` (append ~2898) — reached by the ready-gate repair fence, committer-throw, and dirty-worktree resume paths
- the intent-resume publication-failure append (~2607)
- the review-mutation-resume publication-failure append (~3294)

These reproduce the exact defect class the spec exists to close. The spec must either bring them into scope (tasks, pinning tests, `@mutate` pins, ACs) or carry a Decision that states the deferral and why — and the deferral option contradicts the intent's own "resume" language, so expansion is the expected resolution.

Also state the one legitimate exclusion explicitly: the `iteration_commit_failed` sibling append cannot carry `completionCommitError` — the log event type admits the field only on the `completion_commit_failed` literal variant (`v2/src/persistence/log-stream.ts:49-54`). Naming this prevents an implementer from chasing false parity.

### 2. Split into independently testable subspecs

With resume settlement in scope the slice spans two production files, four distinct settlement families, two test files, and three docs — past a reviewable single PR. Split into subspecs with disjoint verification surfaces (the natural seam is `workflow-runner.ts` + `workflow-runner.test.ts` vs `write-loop.ts` + `write-loop.test.ts`; splitting workflow-runner primary tail from resume settlement is also acceptable if the workflow-runner half is still too large). Every task and acceptance outcome from the current subspec must appear exactly once across the replacements, and every replacement must be linked from `index.md`.

### 3. The publication append is a type restructure, not a field add

At `workflow-runner.ts:1061-1069` the append's `loopOutcomeKind` is `publication.failure.kind` — the full outcome union. A conditional spread of `completionCommitError` onto that shared object does not narrow the sibling discriminant, so it will not typecheck. The spec must describe this site as requiring a narrowed branch for the `completion_commit_failed` case rather than "add the field to each append," so the implementer budgets for it instead of discovering it mid-run. The same applies to the two resume publication appends if they are brought into scope.

### 4. Make the dual-field acceptance criterion reachable and single-file

Two problems with the `completionCommitError` + `publicationFailure` criterion:

- **Reachability.** `publicationFailureFor` only resolves errors that passed through `runPublicationWithRetry`; failures synthesized outside it (e.g. the "pushed completion without PR evidence" path) yield `publicationFailure === undefined`. The currently cited write-loop pinning test drives exactly such a synthetic path and cannot assert both fields without a fixture change. The spec must name a test path that actually produces normalized publication evidence, or scope the AC to the paths where it applies — the flat "publication failures retain both" claim as written is not satisfiable by the named tests.
- **File ambiguity.** The AC names "`workflow-runner.test.ts` or `write-loop.test.ts`." Mutation-checkpoint criteria must name exactly one pinning test file whose basename resolves to one file, and the linked `@mutate` directive must live in that file. Pick one file and align the directive with it.

### 5. Give `@mutate` targets a uniqueness strategy

The natural implementation duplicates text that already exists on the adjacent return statement (`completionCommitError: message,`, `completionCommitError: \`Uncommitted changes: …\``, `completionCommitError: error?.message ?? "completion commit failed"`). A target occurring twice in the file is unparseable and the criterion is refused. The parenthetical "each target text occurs exactly once" asserts the requirement without telling the implementer how to satisfy it; the spec must state how uniqueness is obtained (e.g. mutate a line unique to the append block, or bind the message once and mutate only the append-side usage).

### 6. Settle the no-underlying-error call path

`write-loop.ts:1192` calls `completionCommitFailed` with no `error`, and the helper still returns the synthetic `"completion commit failed"` string to the caller. State whether the log mirrors that fallback (parity with the return, consistent with the core Decision) or omits the field when there is no `Error`. Silence here recreates the defect on that path or invites an arbitrary implementer choice.

### 7. Docs tasks must amend, not duplicate

`v2/docs/v1-behaviors.md:220` and `v2/docs/v2-architecture.md:293` already state that `completion_commit_failed` `loop_finished` events *may carry* `completionCommitError` alongside `publicationFailure` — schema permission, which today's production appends do not exercise. The doc tasks must be framed as amending those existing entries to record that execution loops now *emit* the field on every such append; adding a second parallel bullet leaves the aspirational claim standing. `v2-architecture.md` carries the same claim and is missing from Documentation updates — add it, or state why the `v1-behaviors.md` amendment alone suffices.

### Rationale

Findings 1, 3, and 4 are correctness gaps that would strand or falsely satisfy acceptance criteria under the harness's mutation-checkpoint and agent-verifiability rules. Findings 2 and 5 are scope-honesty gaps: the spec's tasks understate work the type system and the `@mutate` uniqueness rule will force. Finding 6 is an unstated product decision. Finding 7 is required by the repo rule that a spec changing existing behavior updates the parity baseline accurately rather than layering a contradicting claim.