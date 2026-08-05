---
name: criteria-based-subspec-routing
---

# Implement routes to the first subspec with unticked criteria, not the first unchecked index box

`resolveActiveLinkedSubspec` (`shared/linked-subspec-routing.ts`) selects the first subspec whose
`index.md` checkbox is unchecked. A subspec hand-finished and merged without its index box ticked is
re-selected, found complete, and settles `no-work`/`completed` — never advancing to the genuinely
incomplete next subspec. This contradicts the runbook rule that linked-index checkboxes are not the
completion source of truth, which the tree-level `already_complete` preflight already honors.

Observed 2026-08-04 on `20260803T214753Z-fan-out-concurrent-sibling-dispatch`: subspec 00 was
hand-finished and merged (#2584) with its index box unchecked; re-run `328c3cc6` (fresh worktree from
main) selected 00, settled `no-work`/`completed`, and never touched 01. Recovery was a hand-tick of
the index (#2585) and a re-run.

## Decisions

- Routing selects the first linked subspec with an unticked non-human-only acceptance criterion,
  independent of its `index.md` checkbox — rules out re-selecting a hand-finished subspec whose index
  box lags.
- The fully-ticked predicate is shared with the tree-level `already_complete` preflight rather than
  reimplemented per caller — rules out the two answering differently on the same tree.
- A tree where every subspec's non-human-only criteria are ticked settles `already_complete`, never
  `no-work`/`completed` on a single fully-ticked subspec — rules out a false `completed` implying a
  commit, PR, and gate that never happened.
- Routing reads criteria from the spec tree the run executes against; guaranteeing that tree matches
  the resolved `--base` stays a preflight concern — rules out folding a worktree-freshness check into
  the router.
- Harness-side index checkbox advancement on subspec completion is unchanged — rules out a fix that
  stops ticking the index and drifts operator-visible progress.

## Acceptance criteria

- [ ] A regression drives the router against a spec tree whose earlier subspec has all criteria ticked
      but an unchecked `index.md` box, and a later subspec with unticked criteria; it asserts the later
      subspec is selected and fails against index-checkbox routing.
- [ ] A regression asserts a run over a tree with one fully-ticked subspec (index box unchecked) and
      one incomplete subspec does not settle `no-work`/`completed` on the ticked one.
- [ ] `implement-workflow-steps.test.ts`'s "rejects an already-complete linked tree with only a
      wrapped human-only criterion unchecked" stays green (behavior unchanged: a fully-ticked tree with
      only human-only criteria left settles `already_complete`).
- [ ] Mutation checkpoint: inverting the criteria-based selection turns its pinning test RED.

## Documentation updates

- `v2/docs/operator-runbook.md` § Recovery — drop the "hand-finishing must also tick the index box"
  workaround now that the router keys off criteria.
- `v2/docs/v1-behaviors.md` — record criteria-based routing.

## Prerequisites

- `resolveActiveLinkedSubspec` selects the active linked subspec for index-routed implement runs.
- The tree-level `implement.already_complete` preflight classifies a spec with no unchecked non-human-only acceptance criteria.
- Human-only acceptance criteria are excluded from completion requirements by marker matching.
