# Post-completion gates reuse the unchanged-tree green result

## Problem

The post-completion phases each run `bun run ready` independently: the shrink
pre-gate (`shrink.ts`), the review baseline gate (`review.ts`), and the
review-skipped `maybeMarkReady` (`pr.ts`) all call `runReadyAndCommit`. On the
common path (no-op shrink, unchanged tree) the shrink pre-gate and the review
baseline run the full suite back-to-back on the same commit — re-proving an
already-green tree. After `00`, the completion transition already recorded a
green result keyed to tree state, but nothing consumes it.

This subspec makes those three gates reuse that recorded green result when the
tree is unchanged, and re-run `ready` only when the tree changed. It also pins
the predicate `00` deferred (\"unchanged since the recorded green result\") and the
carrier that holds the result across the three differently-typed gates.

## Behavior

### Carrier

The recorded green result is an orchestrator-local value owned by
`tryFinishSpecIfDone` — the function that runs the completion gate (`00`) and
then invokes the three post-completion gates in order. It holds the green sha
(or \"none recorded\", on a red completion gate) and is threaded into each gate as
a new field on that gate's existing options shape (the shrink pre-gate, the
review baseline, and `maybeMarkReady` each take a distinct options type, so each
gets the field on its own type, not a shared global). A gate that re-runs
`ready` on a changed tree refreshes this value to the new green sha so the next
gate in the same run reuses it; the orchestrator holds the latest value between
gates. The carrier is a harness-internal value, not config or telemetry.

### Reuse predicate

Each gate decides reuse by comparing current tree state against the carrier:

- **Tree unchanged** since the recorded green result — current `git rev-parse
  HEAD` equals the recorded sha **and** `git status --porcelain` is clean (both
  halves required): the gate reuses the recorded result and skips its own `bun
  run ready`.
- **Tree changed** — HEAD moved (e.g. a `shrink:` commit landed), or the
  worktree is dirty, or no green result was recorded: the gate runs `bun run
  ready` via the existing `runReadyAndCommit` path as it does today, and on green
  refreshes the carrier to the new tree state.

The clean-worktree half is not cosmetic: it is the safeguard against reusing a
recorded green over a tree that an intervening edit dirtied. For `maybeMarkReady`
specifically it also preserves an operator-facing invariant — today
`maybeMarkReady` runs `runReadyAndCommit` (which re-checks porcelain, commits any
`check:fix`, and throws if still dirty) *immediately before* `gh pr ready`, and
the exit-6 \"worktree guaranteed clean before `gh pr ready`\" guarantee rests on
that re-check. On the reuse branch that re-check is skipped, so the predicate's
clean-worktree half is what upholds the pre-`gh pr ready` cleanliness guarantee
in its place: `maybeMarkReady` reuses (and proceeds to `gh pr ready`) only when
the worktree is verified clean at that moment; a dirty worktree takes the
tree-changed branch and runs `runReadyAndCommit` exactly as today.

### Phase order and chaining

Phase order is unchanged: shrink → review → `maybeMarkReady`. Review and
`maybeMarkReady` are mutually exclusive (review runs when review passes > 0,
else `maybeMarkReady`). The completion gate (`00`) precedes all of these. The
per-iteration early-ready `maybeMarkReady` (which fires inside the iteration loop
when neither shrink nor review will run, *before* the completion gate) is also
in scope: it consults the carrier the same way, so on the green common path it
too reuses rather than re-running. The reuse chains across the order:

- **Common (default) path** — `git: true`, green completion gate, default config
  (`modes.review.passes` ≥ 1, so review runs), no-op shrink, review makes no
  commits: the completion gate runs `ready` once; the shrink pre-gate and the
  review baseline both see an unchanged tree and reuse it. `maybeMarkReady` is
  not reached on this path (review ran). Net across the *reusable* gates: the
  one completion-gate `ready` is reused, not re-run — one reusable `ready` per
  completed spec instead of the two-plus runs today. The review **final** gate
  still runs `ready` unconditionally (see below), so the default path's total
  `ready` count is two (completion gate + review final), down from three-plus.
- **Changed-tree path**: when shrink lands a `shrink:` commit, HEAD moves, so the
  review baseline takes the tree-changed branch, re-runs `ready`, and refreshes
  the carrier. Likewise a `check:fix` commit from any gate's `runReadyAndCommit`
  (including the completion gate's) moves HEAD, so the next gate sees a changed
  tree and re-runs — then refreshes the carrier so a still-later gate reuses the
  re-proved state.

\"No-op shrink\" covers two sub-cases that contribute differently to the count:
the shrink agent ran but produced no diff (the pre-gate executed and reused/ran
per the predicate), versus shrink bailed on an empty allowlist *before* its
pre-gate (the pre-gate never executed, contributing zero `ready` runs). The
common-path count above is stated for the empty-diff sub-case where the
pre-gate runs; the empty-allowlist sub-case has one fewer reusable gate
reached.

### Scope boundary

Scope is the shrink pre-gate, the review baseline gate, `maybeMarkReady`
(completion-transition and per-iteration sites), each reused on an unchanged
tree. The review **final** gate (`bun run ready` immediately before `gh pr
ready`) is explicitly **excluded** from reuse: it still runs `ready`
unconditionally and performs the draft→ready flip. The \"one reusable `ready`\"
accounting is over the in-scope gates only; the unconditional final gate is not
counted in it.

Each in-scope gate already has a test seam that bypasses its `ready` call
(`runPreShrinkGate`, `runBaselineGate`, and `maybeMarkReady`'s `markReady`/
`runReady`); the reuse check composes ahead of that bypass — when a gate is
skipped via its seam the reuse decision is moot.

Green path only, inherited from `00`: when the completion-transition `ready` was
red, no green result was recorded, so every gate takes the tree-changed branch
and runs `ready` itself — identical to today's behavior. This subspec adds no
new red stop reason or exit-code change.

## Decisions

- Reuse is decided per gate by comparing current tree state (HEAD sha **and**
  clean worktree) against the recorded green result — rules out a bare boolean
  that would let a gate reuse a stale green after a `shrink:` or `check:fix`
  commit mutated the tree between gates, and rules out a sha-only check that
  would reuse over an intervening dirty edit.
- The carrier is an orchestrator-local value threaded into each gate's own
  options type and refreshed by a re-running gate — rules out a shared
  module-level global (un-testable, leaks across runs) and rules out re-deriving
  the recorded sha independently inside each gate.
- The clean-worktree half of the predicate is what upholds the pre-`gh pr ready`
  cleanliness guarantee on `maybeMarkReady`'s reuse branch (replacing the skipped
  `runReadyAndCommit` re-check) — rules out skipping the re-check without naming
  what preserves the exit-6 invariant, which would silently weaken it.
- A gate that re-runs `ready` on a changed tree refreshes the recorded green
  result on success — rules out a later same-run gate needlessly re-running
  `ready` after an earlier gate already re-proved the new tree state.
- The review final gate keeps running `ready` unconditionally — rules out
  skipping the verification that immediately precedes the draft→ready flip.

## Tasks

- Thread the orchestrator-local recorded green result from the completion
  transition (`00`) into the shrink pre-gate, the review baseline gate, and
  `maybeMarkReady` (completion-transition and per-iteration sites) as a field on
  each gate's options type.
- In each in-scope gate, reuse the recorded result and skip `bun run ready` when
  the tree is unchanged (HEAD sha equals recorded sha and worktree clean);
  otherwise run `runReadyAndCommit` as today and refresh the carrier on green.
  Compose the reuse check ahead of each gate's existing `ready`-bypass test seam.
- Leave the review final gate (`ready` + `gh pr ready`) unconditional.
- Cover with tests: the default common path runs `ready` once for the in-scope
  reusable gates (completion gate, reused by shrink pre-gate and review baseline)
  plus the unconditional review final gate; a `shrink:` commit forces the review
  baseline to re-run and refresh; a `check:fix` commit moves HEAD and forces the
  next gate to re-run; `maybeMarkReady` reuse proceeds to `gh pr ready` only on a
  verified-clean worktree; a red completion gate makes every gate run `ready`
  itself.

## Acceptance criteria

- [x] On the default common path (`git: true`, green completion gate, `modes.review.passes` ≥ 1 so review runs, shrink agent ran with an empty diff, review makes no commits), the in-scope reusable gates run `bun run ready` exactly once total: the completion gate runs it and the shrink pre-gate and review baseline both reuse that result without re-running. (The unconditional review final gate is excluded from this count.)
- [x] A gate treats the tree as unchanged only when current HEAD sha equals the recorded sha **and** the worktree is clean; if HEAD matches but the worktree is dirty, the gate takes the tree-changed branch and runs `bun run ready`.
- [x] When the tree is unchanged since the recorded green result, the shrink pre-gate skips its own `bun run ready` and reuses the recorded result.
- [x] When the tree is unchanged since the recorded green result, the review baseline gate skips its own `bun run ready` and reuses the recorded result.
- [x] When the tree is unchanged since the recorded green result, `maybeMarkReady` skips its own `bun run ready` and proceeds to `gh pr ready`, having verified the worktree is clean at that point (the predicate's clean-worktree check stands in for the skipped `runReadyAndCommit` re-check).
- [x] When a `shrink:` commit lands (HEAD moves after the completion gate), the review baseline gate re-runs `bun run ready` and, on green, refreshes the recorded green result.
- [x] When a `check:fix` commit moves HEAD at any gate (including the completion gate), the next in-scope gate sees a changed tree, re-runs `bun run ready`, and refreshes the recorded green result.
- [x] When shrink bails on an empty allowlist before its pre-gate, the shrink pre-gate contributes no `bun run ready` run, and reuse still chains to the next reached gate.
- [x] When no green result was recorded at the completion transition (red completion gate), every in-scope gate runs `bun run ready` itself, matching pre-change behavior.
- [x] The review final gate still runs `bun run ready` unconditionally before `gh pr ready`, regardless of any recorded green result.

## Documentation updates

Doc partition with `00`: `00` adds the new completion-gate entry; `01` edits the
existing shrink and review gate descriptions to record reuse and adds the
exit-6 note. The two subspecs touch disjoint lines, keeping each behavior in one
durable home.

- `v1/docs/run-loop.md`: in the Review phase and Post-completion shrink
  sections, replace the per-gate `bun run ready` descriptions with the
  unchanged-tree reuse behavior — the shrink pre-gate, review baseline, and
  `maybeMarkReady` (and the per-iteration early-ready site) reuse the recorded
  green result when the tree is unchanged and re-run only on a changed tree; note
  the review final gate stays unconditional, and the net is one reusable `ready`
  per completed spec on the default common path (the unconditional final gate is
  separate). In the exit-`6` row, note that on `maybeMarkReady`'s reuse branch
  the predicate's clean-worktree check (not the now-skipped `runReadyAndCommit`
  re-check) is what guarantees the worktree is clean before `gh pr ready`.
- `v2/docs/v1-behaviors.md`: update the post-completion shrink and review-phase
  entries to record gate reuse of the recorded green result on an unchanged tree
  (and re-run + refresh on a changed tree), the per-iteration site inclusion, the
  final-gate carve-out, and the exit-6 guarantee shift, with sources
  (`v1/src/modes/patch/run.ts`, `shrink.ts`, `review.ts`, `pr.ts`,
  `v1/src/ready-gate.ts`).
