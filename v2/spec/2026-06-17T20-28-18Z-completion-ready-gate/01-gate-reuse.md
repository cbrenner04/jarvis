# Post-completion gates reuse the unchanged-tree green result

## Problem

The post-completion phases each run `bun run ready` independently: the shrink
pre-gate (`shrink.ts`), the review baseline gate (`review.ts`), and the
review-skipped `maybeMarkReady` (`pr.ts`) all call `runReadyAndCommit`. On the
common path (no-op shrink, unchanged tree) the shrink pre-gate and the review
baseline run the full suite back-to-back on the same commit — re-proving an
already-green tree. After `00`, the completion transition already recorded a
green result keyed to tree state, but nothing consumes it.

This subspec makes the three gates reuse that recorded green result when the
tree is unchanged, and re-run `ready` only when the tree changed.

## Behavior

Each post-completion gate that today calls `runReadyAndCommit` unconditionally
instead consults the green result recorded at the completion transition (`00`):

- **Tree unchanged** since the recorded green result (current HEAD sha equals
  the recorded sha and the worktree is clean): the gate reuses the recorded
  result and skips its own `bun run ready`.
- **Tree changed** (HEAD moved — e.g. a `shrink:` commit landed — or the
  worktree is dirty, or no green result was recorded): the gate runs `bun run
  ready` via the existing `runReadyAndCommit` path as it does today, and on
  green updates the recorded result to the new tree state so a later gate in the
  same run can reuse it in turn.

Phase order is unchanged: shrink → review → `maybeMarkReady`. The reuse chains
across that order:

- Common path (no-op shrink, review makes no commits): the completion gate runs
  `ready` once; the shrink pre-gate, review baseline, and (when reached)
  `maybeMarkReady` all see an unchanged tree and reuse it. Net: one `ready` per
  completed spec instead of two-plus.
- Changed-tree path: when shrink lands a `shrink:` commit, the review baseline
  sees a changed tree and re-runs `ready` (refreshing the recorded result);
  likewise a `check:fix` commit from any gate's `runReadyAndCommit` moves HEAD,
  so the next gate re-runs.

Scope is the three gates the intent names: the shrink pre-gate, the review
baseline gate, and `maybeMarkReady`. The review **final** gate (`bun run ready`
immediately before `gh pr ready`) is unchanged — it still runs unconditionally
and performs the draft→ready flip.

Green path only, inherited from `00`: when the completion-transition `ready` was
red, no green result was recorded, so every gate takes the tree-changed branch
and runs `ready` itself — identical to today's behavior. This subspec adds no
new red stop reason or exit-code change.

## Decisions

- Reuse is decided per gate by comparing current tree state (HEAD sha + clean
  worktree) against the recorded green result — rules out a bare boolean that
  would let a gate reuse a stale green after a `shrink:` or `check:fix` commit
  mutated the tree between gates.
- A gate that re-runs `ready` on a changed tree refreshes the recorded green
  result on success — rules out a later same-run gate needlessly re-running
  `ready` after an earlier gate already re-proved the new tree state.
- The review final gate keeps running `ready` unconditionally — rules out
  skipping the verification that immediately precedes the draft→ready flip.

## Tasks

- Thread the recorded green result from the completion transition (`00`) into
  the shrink pre-gate, the review baseline gate, and `maybeMarkReady`.
- In each of those three gates, reuse the recorded result and skip `bun run
  ready` when the tree is unchanged; otherwise run `runReadyAndCommit` as today
  and refresh the recorded result on green.
- Leave the review final gate (`ready` + `gh pr ready`) unconditional.
- Cover with tests: common path runs `ready` exactly once across the completion
  gate plus the three post-completion gates; a `shrink:` commit forces the
  review baseline to re-run; a red completion gate makes every gate run `ready`
  itself.

## Acceptance criteria

- [ ] On the common completion path (`git: true`, green completion-transition `ready`, no-op shrink, review makes no commits), `bun run ready` runs exactly once across the completion transition and all post-completion gates.
- [ ] When the tree is unchanged since the recorded green result, the shrink pre-gate skips its own `bun run ready` and reuses the recorded result.
- [ ] When the tree is unchanged since the recorded green result, the review baseline gate skips its own `bun run ready` and reuses the recorded result.
- [ ] When the tree is unchanged since the recorded green result, `maybeMarkReady` skips its own `bun run ready` and proceeds to `gh pr ready`.
- [ ] When a `shrink:` commit lands (HEAD moves after the completion gate), the review baseline gate re-runs `bun run ready` and, on green, refreshes the recorded green result.
- [ ] When no green result was recorded at the completion transition (red completion gate), every post-completion gate runs `bun run ready` itself, matching pre-change behavior.
- [ ] The review final gate still runs `bun run ready` unconditionally before `gh pr ready`, regardless of any recorded green result.

## Documentation updates

- `v1/docs/run-loop.md`: replace the per-gate `bun run ready` descriptions in
  the Review phase and Post-completion shrink sections with the unchanged-tree
  reuse behavior — the shrink pre-gate, review baseline, and `maybeMarkReady`
  reuse the recorded green result when the tree is unchanged and re-run only on a
  changed tree; note the review final gate stays unconditional and the net is
  one `ready` per completed spec on the common path.
- `v2/docs/v1-behaviors.md`: update the post-completion shrink and review-phase
  entries to record gate reuse of the recorded green result on an unchanged
  tree (and re-run on a changed tree), with sources.
