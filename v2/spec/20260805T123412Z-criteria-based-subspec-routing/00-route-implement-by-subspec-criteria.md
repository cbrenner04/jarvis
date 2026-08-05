# Route implement by subspec criteria

## Problem

`resolveActiveLinkedSubspec` (`shared/linked-subspec-routing.ts:60`) picks the first link
with `!link.checked`. `validateImplementSpecTreeCompletion`
(`v2/src/execution/implement-workflow-steps.ts:358`) judges the same tree by unticked
non-human-only acceptance criteria and ignores index checkboxes. The two disagree whenever a
subspec is hand-finished and merged without its index box ticked: the preflight admits the
run, routing re-selects the finished subspec, the agent finds nothing to do, and the workflow
settles `no-work`/`completed` — never reaching the incomplete sibling.

Observed 2026-08-04 on `20260803T214753Z-fan-out-concurrent-sibling-dispatch`: subspec 00 was
hand-finished and merged (#2584) with its index box unchecked; re-run `328c3cc6` from a fresh
worktree selected 00, settled `no-work`/`completed`, and never touched 01. Recovery was a
hand-tick of the index (#2585) plus a re-run.

Fixing selection alone is not enough. `runLinkedImplementStep`
(`v2/src/execution/workflow-runner.ts:614-628`) re-resolves the active link a **second time**
after the write loop reports the iteration complete, and feeds that second result's
index/isTerminal/body into `completeLinkedSubspec`. Index routing tolerated this because the
agent cannot tick the index checkbox itself. Criteria routing does not: the agent has just
ticked the active subspec's own criteria, so the second resolve walks past it — landing on the
next incomplete link (wrong index/body checked for completion) or on `already_complete` (which
short-circuits to `kind: "complete", implementReviewEligible: false` and never advances any
checkbox). On the intent's own reported tree, this exits `complete`, review-ineligible, with
01's checkbox never ticked — reproducing the bug the routing fix was meant to close.

## Decision ledger

- Selection scans links in order and picks the first whose subspec body has an unticked
  non-human-only acceptance criterion, ignoring its `index.md` checkbox — rules out
  re-selecting a hand-finished subspec whose index box lags.
- The unticked-criteria predicate moves into `shared/linked-subspec-routing.ts` and is
  consumed by `validateImplementSpecTreeCompletion`, `resolveActiveLinkedSubspec`, and
  `completeLinkedSubspec` alike — rules out any two of router, preflight, and completion
  answering differently on the same tree.
- `isTerminal` no longer means "selected index is the last link". It means: after the selected
  link's criteria are satisfied, every other link in the tree already has none unticked —
  computed by checking the remaining links' current bodies during the same selection pass.
  Rules out losing review eligibility, terminal shrink, and finalization when a pre-ticked
  final link causes routing to land on an earlier, non-last link that is nonetheless the only
  work left.
- `runLinkedImplementStep` resolves the active link **once** per loop iteration, before running
  the write loop, and reuses that same selected index and isTerminal for completion. It does
  not re-run selection afterward. To read back the agent's edits and recompute isTerminal
  against their current, possibly worktree-materialized location, it re-resolves only the
  pinned link at that same index (path, body, and a fresh isTerminal scan over the other
  links) — never re-scans for a new "first incomplete" candidate. This preserves the existing
  behavior where the pre-write resolve reads from the project root (worktree not yet
  materialized) but the post-write completion check and checkbox advance target the
  materialized worktree.
- A subspec with no unticked non-human-only criteria (including one with no criteria at all)
  counts complete and is skipped — rules out routing to a vacuous subspec the preflight
  already treats as complete.
- A link that is unreadable, malformed, or out-of-tree fails routing with its named
  `errorKind` even when it sits before a later link that would otherwise be selected — rules
  out silently scanning past a broken link, matching the existing preflight walk in
  `implement-workflow-steps.ts:373-382`.
- A tree whose subspecs are all fully ticked returns `already_complete` from
  `resolveActiveLinkedSubspec` itself, and the launch preflight keeps rejecting it before any
  worktree or run row — rules out a `no-work`/`completed` settle implying a commit, PR, and
  gate that never happened.
- A link skipped because its own subspec is already criteria-complete keeps whatever state its
  `index.md` checkbox was last left in (commonly unchecked, e.g. the hand-finished-without-
  ticking case this spec fixes) — routing and completion no longer read it, and a run that
  finishes a later sibling does not retroactively tick it. This is expected drift in the
  checkbox display, not a regression to prevent.
- Routing reads criteria from the spec tree the run executes against; guaranteeing that tree
  matches the resolved `--base` stays a preflight concern — rules out folding a
  worktree-freshness check into the router.
- The existing `@mutate` directive at `v2/src/execution/implement-workflow-steps.test.ts:335`
  is re-pointed at the predicate's new home — rules out a stale directive path that blocks
  completion.

## Task checklist

- Export the shared unticked-non-human-only-criteria predicate from
  `shared/linked-subspec-routing.ts`; consume it in `validateImplementSpecTreeCompletion`,
  `resolveActiveLinkedSubspec`, and `completeLinkedSubspec` (removing the last's inline copy).
- Switch `resolveActiveLinkedSubspec` selection to that predicate: scan links in order, error
  immediately on the first unreadable/malformed/out-of-tree link, skip links whose body is
  already criteria-complete, and select the first that is not. Compute `isTerminal` by scanning
  the remaining links (after the selected one) for any unticked criteria.
- In `workflow-runner.ts`, stop the post-write re-resolve in `runLinkedImplementStep`. Resolve
  the active link once per iteration; after the write loop completes, re-resolve only that
  pinned index's current path/body/isTerminal (not a fresh selection) for
  `completeLinkedSubspec`.
- Update `shared/linked-subspec-routing.test.ts` fixtures used by the classification test so
  each carries a real acceptance criterion (currently criteria-free bodies like `"# One"`) —
  the multi-link case must keep exercising "selects the second, unchecked-in-index-but-
  incomplete link", not flip to `already_complete`.
- Add router, `completeLinkedSubspec`, and `executeWorkflow` regressions per the acceptance
  criteria below.
- Update docs.

## Acceptance criteria

- [ ] `shared/linked-subspec-routing.test.ts` regression drives `resolveActiveLinkedSubspec`
      against a tree whose first link is unchecked in `index.md` but has all non-human-only
      criteria ticked and whose second link has an unticked criterion; it asserts
      `active.index` is 1 and fails against index-checkbox routing.
- [ ] `shared/linked-subspec-routing.test.ts` regression asserts a tree whose links are all
      unchecked in `index.md` but whose every subspec is fully ticked returns
      `errorKind: "already_complete"`; fails against index-checkbox routing.
- [ ] `shared/linked-subspec-routing.test.ts` regression asserts a tree whose *last* link is
      fully ticked (index box unchecked) and whose only earlier incomplete link is not last
      selects that earlier link with `isTerminal: true`; a second case with a further later
      link still incomplete selects the earlier link with `isTerminal: false`. Both fail against
      `isTerminal: selectedIndex === links.length - 1`.
- [ ] `shared/linked-subspec-routing.test.ts` regression asserts a link that fails to resolve
      (unreadable, malformed, or out-of-tree) still fails routing with its named `errorKind`
      when it sits before a later, otherwise-selectable incomplete link.
- [ ] `shared/linked-subspec-routing.test.ts` regression asserts a link whose subspec body has
      zero acceptance criteria is treated as complete and skipped in favor of a later
      incomplete link.
- [ ] `v2/src/execution/workflow-runner.test.ts` regression drives `executeWorkflow` with
      `linkedIndexRouting: true` over a worktree tree whose first subspec is fully ticked with
      an unchecked index box and whose second subspec is incomplete: the write loop is invoked
      with the second subspec as `expectedArtifactPath`; on completion the second subspec's
      index checkbox advances while the first's stays exactly as it started; and the workflow
      returns `kind: "complete"` with `implementReviewEligible: true`. Fails against both
      index-checkbox routing and against the current post-write re-resolve.
- [ ] `v2/src/execution/workflow-runner.test.ts`'s "reads index from project root when worktree
      is absent and advances checkbox in worktree only" stays green (the pre-write resolve
      still reads the project-root index before the worktree is materialized, and completion
      still advances the checkbox in the worktree's index only).
- [ ] `v2/src/execution/implement-workflow-steps.test.ts`'s "rejects an already-complete linked
      tree with only a wrapped human-only criterion unchecked" stays green (a fully-ticked tree
      with only human-only criteria left still settles `already_complete`).
- [ ] `shared/linked-subspec-routing.test.ts`'s "classifies completion, detects routing
      mutation, and advances" stays green with its fixtures updated to carry real criteria
      (index advancement behavior unchanged by the routing change).
- [ ] Mutation checkpoint: inverting the criteria-based selection guard in
      `shared/linked-subspec-routing.ts` turns its pinning test in
      `shared/linked-subspec-routing.test.ts` RED via a linked `@mutate` directive, with no
      production inversion hook.
- [ ] Mutation checkpoint: reverting `runLinkedImplementStep` to re-run selection after the
      write loop (instead of reusing the pre-write pinned index) turns its pinning test in
      `v2/src/execution/workflow-runner.test.ts` RED via a linked `@mutate` directive, with no
      production inversion hook.
- [ ] The `@mutate` directive at `v2/src/execution/implement-workflow-steps.test.ts:335` is
      re-pointed at the predicate's new home in `shared/linked-subspec-routing.ts` and still
      turns its pinning test red.
- [ ] `bun run typecheck`, `bun run test:v1`, `bun run test:v2`, and
      `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` § Linked-subspec routing — selection is by unticked
  non-human-only criteria, not the index checkbox; `isTerminal` means the selected link is the
  last one with unticked criteria remaining, not the last link position; pre-selection link
  failures still classify in order.
- `v2/docs/write-behavior.md` § Implement routing to linked subspecs — same correction to
  "first unchecked linked subspec".
- `v2/docs/operator-runbook.md` — the existing "Linked-index checkboxes are not the completion
  source of truth" note (currently a bare preflight statement, no hand-tick workaround exists
  today to remove) gains one sentence: subspec *routing* now keys off criteria the same way, so
  a hand-finished-and-merged subspec with a lagging index box is skipped automatically on
  re-run rather than needing its box hand-ticked first.
- `v2/docs/v1-behaviors.md` — correct the v2 implement routing entry (currently at line 85):
  fix the stale `v2/src/execution/linked-subspec-routing.ts` path to `shared/linked-subspec-
  routing.ts`; replace "the first unchecked link is then resolved" with the criteria-based
  selection rule; replace "empty/already-complete indexes return complete without work" with
  the corrected rule that a tree with a criteria-complete individual link skips it and routes
  to the next incomplete link, while a tree whose links are *all* criteria-complete returns
  `already_complete` regardless of index-checkbox state.
