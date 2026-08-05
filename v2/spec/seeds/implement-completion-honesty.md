---
name: implement-completion-honesty
---

# A `completed` implement row can lie: stale worktree reuse, index-checkbox routing, timeout retirement

One bundle: three ways an implement run falsifies the runbook contract that `completed` implies a
completion commit, PR evidence, and a green gate. They share `resetStaleWorkspace`, the
`no-work` → `completed` boundary, and the criteria-vs-index-checkbox source-of-truth question — and
two of them add **opposing gates to the same preflight**, whose precedence must be decided once,
not by whichever lands second. Absorbs `implement-rerun-completes-over-a-stale-dirty-worktree`,
`implement-router-reselects-fully-ticked-subspec-by-index-checkbox`, and
`iteration-timeout-discards-completed-subspecs` (2026-08-04).

## Problem A — a re-run executes in a stale dirty worktree and settles `completed` having committed nothing

Observed 2026-08-03, run `eabc39a7` on `20260803T013930Z-tui-command-dispatch`. Telemetry
`worktree_path` named the pre-existing managed worktree: HEAD three commits behind the resolved
`--base`, four modified tracked paths left by an earlier `iteration_timeout` run.
`resetStaleWorkspace` neither retired it nor refused. The write step read the subspec from the dirty
worktree — where the previous run had already ticked all four criteria — found nothing to do, and
settled `no_file_changes` → `no-work` → `completed`. Nothing was committed, pushed, published, or
gated; the real work sat uncommitted and was salvaged by hand (PR #2575). The successor review step
then ran 75+ minutes against the debris worktree until hand-killed — had it committed,
`git add -A` would have shipped a stranded `@mutate` application sitting on disk.

**Root cause is not established.** Re-running the identical command later refused at the *live-run*
gate, which precedes the dirty gate in `resetStaleWorkspace`, so the dirty gate was never exercised
in reproduction. Do not cut a fix against a guessed cause — the first acceptance criterion for this
path is a reproduction.

## Problem B — the router re-selects a fully-ticked subspec by its unchecked index checkbox

The write step routes to the next subspec by the first unchecked `index.md` checkbox, not the first
subspec with unticked acceptance criteria. A subspec hand-finished and merged without its index box
ticked is re-selected, found complete, and settles `no-work`/`completed` — never advancing to the
genuinely-incomplete next subspec. This contradicts the runbook's own rule that linked-index
checkboxes are not the completion source of truth, which the ALREADY_COMPLETE preflight honors but
the per-subspec router does not.

Observed 2026-08-04, `20260803T214753Z-fan-out-concurrent-sibling-dispatch`: subspec 00
hand-finished and merged (#2584) with its index box unchecked; re-run `328c3cc6` (fresh worktree
from main) selected 00, settled `no-work`/`completed`, never touched 01. Recovery: hand-tick the
index (#2585), re-run. Distinct from A — fresh worktree, honest tree, index-mismatched `main`.

## Problem C — an iteration timeout discards completed subspec work

`iteration_timeout` settles `resumable: false`, `nextAction: "stop"`. The documented recovery is a
fresh implement run whose preflight retires the stale workspace — worktree, local branch, remote
branch — and rematerializes from `--base`. On a multi-subspec spec that destroys every subspec the
run already finished. Observed 2026-07-30 on `20260730T225359Z-pipeline-stage-resolve-prior-worktree`
(subspecs 00 and 01 complete: 11 criteria ticked, three iteration commits on the branch; only 02
partial) — re-dispatch would have redone ~40 minutes of landed work; recovery was a hand-finish
(#2363). Second of the class: the prior session's slice 6 (#2352). Raising the timeout values
reduces frequency, not data loss.

## Decisions

- A reproduction lands before any fix for the stale-dirty reuse path (A) — rules out fixing a cause
  that was never demonstrated.
- An implement re-run refuses or retires when the managed worktree HEAD is not a descendant of the
  resolved `--base`, independently of dirty state — rules out silently reusing a stale branch tip
  whose spec copy disagrees with the base.
- A write step resolving `no-work` while its worktree holds uncommitted tracked changes settles a
  named non-`completed` failure listing those paths — rules out reporting success over work that
  was never committed.
- Completeness and routing decisions read the spec tree as it exists at the run's own base, and the
  router selects the first subspec with unticked non-human-only acceptance criteria, independent of
  its `index.md` checkbox — rules out inheriting another run's ticks and rules out re-selecting a
  hand-finished subspec whose index box lags.
- A run that finds every subspec's criteria ticked settles `already_complete` (the existing
  tree-level contract), never `no-work`/`completed` on a single fully-ticked subspec — rules out a
  false `completed` that implies a commit/PR/gate that never happened.
- An `iteration_timeout` with at least one fully satisfied subspec settles `resumable: true` /
  `nextAction: "resume"`; resume continues the retained branch and worktree with its iteration
  commits — no `resetStaleWorkspace`, no rematerialization from `--base`. A run with no completed
  subspec keeps the current `stop` settlement. The settle carries a completion inventory naming
  completed and remaining subspec paths — rules out "re-dispatch and redo" as the sole recovery and
  rules out an opaque timeout.
- `resetStaleWorkspace` gains both new gates with fixed precedence — **preserve before reuse**: it
  first refuses to retire a workspace whose spec tree has criteria ticked that are unticked on
  `--base`, naming them (an explicit override flag proceeds); only a retire-safe workspace is then
  eligible for the stale/dirty reuse refusal. A worktree that is both dirty and carrying landed
  ticks refuses with both conditions named — rules out gate order being decided implicitly.
- Whether timeout recovery is `jarvis run resume` or a distinct re-entry is open; prefer `resume`
  (fold into the existing command per the north star) — pin at planning.
- Out of scope: the timeout values themselves, successor-step stalls
  (`implement-review-publication-successor-stalls-indefinitely`), and stranded mutations
  (`mutation-checkpoint-verifier-trust`).

## Acceptance criteria

- [ ] A regression drives the implement re-run preflight against a managed worktree whose HEAD is
      behind the resolved base **and** has uncommitted tracked paths, and asserts a refusal naming
      those paths; it fails against the current preflight.
- [ ] A regression asserts an implement re-run refuses when the managed worktree HEAD is not a
      descendant of the resolved `--base`, with a clean worktree, naming base and worktree HEAD.
- [ ] A regression asserts a write step that resolves `no-work` over a worktree with uncommitted
      tracked paths settles a non-`completed` status naming those paths, and that `run list` /
      `wait` project it; it fails against the current boundary.
- [ ] A regression drives the router against a spec tree whose earlier subspec has all criteria
      ticked but an unchecked `index.md` box and a later subspec with unticked criteria; it asserts
      the router selects the later subspec, and fails against index-checkbox routing.
- [ ] A regression asserts a run over a tree where one subspec is fully ticked (index box unchecked)
      and another is incomplete does not settle `no-work`/`completed` on the ticked one.
- [ ] An implement run that settles `iteration_timeout` with at least one subspec's non-human-only
      criteria fully ticked reports `resumable: true` / `nextAction: "resume"` on `run list` /
      `wait`; a run with no completed subspec keeps `resumable: false` / `stop`. Inverting the
      completed-subspec predicate makes the regression red.
- [ ] The `iteration_timeout` operator error carries a completion inventory naming each completed
      subspec path and each remaining one; a test pins both lists against a tree with one complete
      and one incomplete subspec.
- [ ] Resuming such a run continues on the retained branch and worktree — no `resetStaleWorkspace`,
      no rematerialization — and the pre-existing iteration commits are still reachable from the
      branch head after the resume settles.
- [ ] `resetStaleWorkspace` refuses to retire a workspace whose managed worktree's spec tree has
      criteria ticked that are unticked on `--base`, names those subspec paths on stderr, and
      changes nothing; the documented override flag proceeds. A regression covers both.
- [ ] A worktree that is both dirty and carrying ticks absent from `--base` refuses with both
      conditions named — the preserve gate is checked before the reuse gate; a regression pins the
      order.
- [ ] Mutation checkpoints: `// @mutate` directives inverting the descendant check, the
      dirty-`no-work` refusal, and the criteria-based router selection each turn their pinning test
      RED.
- [ ] `bun run typecheck`, `bun run check`, `bun run lint:md`, `bun run test:v2`, and
      `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — a `completed` implement row no longer admits the
  `no-work`-over-dirty or index-lag cases; state what `no-work` now settles; `iteration_timeout` is
  conditionally resumable.
- `v2/docs/operator-runbook.md` § Recovery — replace the "re-run the spec" guidance for
  `iteration_timeout` with the completed-subspec decision; document the retirement refusal and its
  override; drop the "hand-finishing must also tick the index box" workaround once the router keys
  off criteria.
- `v2/docs/v1-behaviors.md` — record the descendant-check preflight, the dirty `no-work` refusal,
  criteria-based routing, and the changed `iteration_timeout` resumability contract.

## Prerequisites

- `resetStaleWorkspace` and its gate order (`v2/src/commands/cleanup.ts`), reached from
  `maybeResetStaleWorkspace` (`v2/src/commands/workflow.ts`)
- The write-loop completion boundary that maps `no-work` to `runStatus: "completed"`
- The implement write-step subspec router (`index.md` checkbox scan) and the tree-level
  ALREADY_COMPLETE preflight
- Per-iteration commit checkpointing on every settled main-loop iteration (fixed 2026-07-27)
