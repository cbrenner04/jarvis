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

## Decision ledger

- Selection scans links in order and picks the first whose subspec body has an unticked
  non-human-only acceptance criterion, ignoring its `index.md` checkbox — rules out
  re-selecting a hand-finished subspec whose index box lags.
- The unticked-criteria predicate moves into `shared/linked-subspec-routing.ts` and
  `validateImplementSpecTreeCompletion` imports it — rules out router and preflight answering
  differently on the same tree.
- A subspec with no unticked non-human-only criteria (including one with no criteria at all)
  counts complete and is skipped — rules out routing to a vacuous subspec the preflight
  already treats as complete.
- A link that is unreadable or out-of-tree fails routing with its named `errorKind` even when
  it sits before the selected link — rules out silently scanning past a broken link.
- A tree whose subspecs are all fully ticked returns `already_complete`, and the launch
  preflight keeps rejecting it before any worktree or run row — rules out a `no-work`/
  `completed` settle implying a commit, PR, and gate that never happened.
- Routing reads criteria from the spec tree in the executed worktree; guaranteeing that tree
  matches the resolved `--base` stays a preflight concern — rules out folding a
  worktree-freshness check into the router.
- Harness index-checkbox advancement on subspec completion (`completeLinkedSubspec`,
  `advanceLinkedSubspecCheckbox`) is unchanged — rules out a fix that stops ticking the index
  and drifts operator-visible progress.
- The existing `@mutate` directive at `v2/src/execution/implement-workflow-steps.test.ts:335`
  is re-pointed at the predicate's new home — rules out a stale directive path that blocks
  completion.

## Task checklist

- Export the shared unticked-non-human-only-criteria predicate from
  `shared/linked-subspec-routing.ts`; consume it in `validateImplementSpecTreeCompletion`.
- Switch `resolveActiveLinkedSubspec` selection to that predicate, reading each candidate
  subspec body in index order and preserving path resolution and `errorKind` classification.
- Update `shared/linked-subspec-routing.test.ts` fixtures whose bodies carry no criteria (they
  now read as complete).
- Add router and `executeWorkflow` regressions for the lagging-index-box tree.
- Update docs.

## Acceptance criteria

- [ ] `shared/linked-subspec-routing.test.ts` regression drives `resolveActiveLinkedSubspec`
      against a tree whose first link is unchecked in `index.md` but has all non-human-only
      criteria ticked and whose second link has an unticked criterion; it asserts
      `active.index` is 1 and fails against index-checkbox routing.
- [ ] `shared/linked-subspec-routing.test.ts` regression asserts a tree whose links are all
      unchecked in `index.md` but whose every subspec is fully ticked returns
      `errorKind: "already_complete"`; fails against index-checkbox routing.
- [ ] `v2/src/execution/workflow-runner.test.ts` regression drives `executeWorkflow` with
      `linkedIndexRouting: true` over a worktree tree whose first subspec is fully ticked with
      an unchecked index box and whose second subspec is incomplete; it asserts the write loop
      is invoked with the second subspec as `expectedArtifactPath` and that the workflow does
      not return `complete` with zero iterations consumed; fails against index-checkbox
      routing.
- [ ] `v2/src/execution/implement-workflow-steps.test.ts`'s "rejects an already-complete linked
      tree with only a wrapped human-only criterion unchecked" stays green (a fully-ticked tree
      with only human-only criteria left still settles `already_complete`).
- [ ] `shared/linked-subspec-routing.test.ts`'s "classifies completion, detects routing
      mutation, and advances" stays green (index advancement unchanged by the routing change).
- [ ] Each added or modified guard carries a `// @mutate` directive in its pinning test
      naming its real source condition in `shared/linked-subspec-routing.ts`, and the existing
      directive in `v2/src/execution/implement-workflow-steps.test.ts` is re-pointed at the
      predicate's new location; every mutation turns its test red with no production inversion
      hook.
- [ ] `bun run typecheck`, `bun run test:v1`, `bun run test:v2`, and
      `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` § Linked-subspec routing — selection is by unticked
  non-human-only criteria, not the index checkbox; pre-selection link failures still classify.
- `v2/docs/write-behavior.md` § Implement routing to linked subspecs — same correction to
  "first unchecked linked subspec".
- `v2/docs/operator-runbook.md` — extend the existing "Linked-index checkboxes are not the
  completion source of truth" note to cover subspec routing, so a hand-finished subspec no
  longer needs its index box hand-ticked before a re-run.
- `v2/docs/v1-behaviors.md` — record criteria-based routing on the v2 implement routing entry.
