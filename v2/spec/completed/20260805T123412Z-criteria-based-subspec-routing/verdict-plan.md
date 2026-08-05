## Verdict — refinement required

The spec's stated scope is wrong, not oversized. Keep one subspec (`00`), but it must cover the workflow loop that consumes the router. As written, an implementer can complete the task checklist, tick all eight criteria, and ship a workflow that cannot finish any subspec — including the exact scenario the intent reports.

### 1. The write-loop's post-write re-resolve must be in scope (critical)

`runLinkedImplementStep` (`v2/src/execution/workflow-runner.ts:614-628`) calls `resolveActiveLinkedSubspec` a **second** time after the write loop reports complete, and passes that result's `active.index`/`isTerminal`/`body` into `completeLinkedSubspec`. Index routing makes this safe because the agent cannot tick the index. Criteria routing breaks it: the agent has just ticked the active subspec's criteria, so the re-resolve returns the *next* link — or `already_complete`, which routes through `linkedImplementRoutingFailureOutcome` to `kind: "complete", implementReviewEligible: false` (`workflow-runner.ts:454-461`), skipping checkbox advancement, terminal shrink, review, and PR finalization. On the intent's own reported tree (00 ticked, 01 incomplete), the spec as written selects 01, finishes it, then exits `complete` with review ineligible and no checkbox ever advanced.

The spec must carry a decision on how the finalize pass obtains the just-completed subspec's identity and body without re-running routing, a task on `workflow-runner.ts`, and an acceptance criterion pinning it. Decision 5's appeal to the launch preflight does not cover this in-loop path.

Also name `v2/src/execution/workflow-runner.test.ts`'s "reads index from project root when worktree is absent and advances checkbox in worktree only" as a preservation criterion — it is this exact scenario and goes red on a naive implementation, so it must be pinned rather than left as the cheapest thing to weaken.

### 2. The `executeWorkflow` regression must assert positively

The current criterion ("does not return `complete` with zero iterations consumed") is satisfied by a broken implementation that settles `contract_miss`. Rewrite it to assert the successful path: the write loop is invoked with the second subspec as the completion artifact, that subspec's index checkbox advances, and the workflow returns complete with review eligible.

### 3. `isTerminal` must be decided under skipping

`isTerminal` is `selectedIndex === links.length - 1` (`shared/linked-subspec-routing.ts:95`) and gates `implementReviewEligible` (`workflow-runner.ts:542`). Under criteria routing, a tree whose **last** subspec is pre-ticked routes to an earlier link with `isTerminal: false`, so the run silently loses review, terminal shrink, and finalization that index routing delivered. A leading skipped link also leaves `- [ ] 00` permanently unchecked, contradicting decision 7's claim of no operator-visible drift. Both need explicit decisions and coverage.

### 4. The preservation criterion cites the wrong test

Every fixture body in `shared/linked-subspec-routing.test.ts:25` is criteria-free (`"# One"`, `"# Two"`, `"# Three"`), so the classification test "handles direct, empty, completed, malformed, unreadable, active, terminal, and multiple links" changes meaning across all seven cases — its multi-link assertion flips from `active.index: 1` to `already_complete`. The spec's preservation criterion instead cites "classifies completion, detects routing mutation, and advances", which exercises `completeLinkedSubspec` and is untouched. Cite the classification test, and require its fixtures to gain real criteria so the cases keep testing what they name — do not let expectations flip to `already_complete`.

### 5. The mutation-checkpoint criterion will not select

Per spec guidance, a criterion is selected only by a `Mutation checkpoint:` prefix or a directive-shaped `@mutate`; the current wording has neither, so the harness never applies the mutation. It also backticks a source path alongside two test paths in one clause — the criterion must unambiguously name the pinning test file. The intent's own phrasing would have selected; restore that form.

### 6. Third predicate copy

`completeLinkedSubspec` (`shared/linked-subspec-routing.ts:123-125`) carries its own inline copy of the unticked-non-human-only test. The ledger and checklist name only `validateImplementSpecTreeCompletion`. Decision 2's "one predicate, one answer" is not achieved while a third copy survives — add it.

### 7. Two missing coverage criteria

- The docs bullet promises "pre-selection link failures still classify"; decision 4 names it; no criterion covers it. Add one for an earlier malformed/unreadable/out-of-tree link failing with its named kind even when a later link is incomplete. (This aligns the router with the existing preflight walk in `implement-workflow-steps.ts:373-382`, not a new regression.)
- Decision 3's vacuous-subspec skip has no criterion. One cheap pin; no cross-surface reconciliation with cleanup archival is warranted.

### 8. Documentation targets

- The intent's runbook target does not exist: `v2/docs/operator-runbook.md:277` is a bare statement of the preflight rule with no hand-tick workaround to drop. The spec substituted a different edit silently — state the substitution and what the corrected note asserts.
- `v2/docs/v1-behaviors.md:85` needs named corrections, not "record criteria-based routing": it cites the stale path `v2/src/execution/linked-subspec-routing.ts` (the file is `shared/`), states "the first unchecked link is then resolved", and states "empty/already-complete indexes return complete without work" — the last is the very behavior under change and must reflect whatever decision resolves item 1.

### Not upheld

`stepId` is keyed on link index, which is stable per subspec position; skipping omits a step id but does not renumber others — no refinement needed. The concern that the shared predicate's `@mutate` directive collides with the copy in `completeLinkedSubspec` does not hold: the target text occurs exactly once today, and folding that copy into the shared predicate removes the question entirely.

**Priority:** items 1–3 are one coherent fix and must land together; then 4 and 5; then 8, 6, 7.