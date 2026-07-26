# Per-iteration commits did not happen on three runs, though the feature exists

## Problem

**Corrected framing.** Per-iteration commits are already specified and implemented:
`v2/spec/completed/20260724T211609Z-commit-each-write-iteration`, and
`commitProgressIteration` (`v2/src/execution/write-loop.ts:1365`) is invoked on every
`result.kind === "progress"` iteration, with `iterationCommitFailed` as its failure path. This seed is
**not** a request to build that feature.

The observed problem is that it did not produce commits. Three runs on 2026-07-25 recorded progress
boundaries in their logs and left **zero** commits on the branch with a large dirty tree.

**The feature demonstrably works on runs that complete.** Merged PRs from the same session carry the
per-iteration signature — several commits with the same headline, one per iteration:

| PR | commits |
| --- | --- |
| #2162 snapshot-continue | 2 |
| #2164 role-timeout | 2 |
| #2157 / #2163 / #2168 (single-iteration) | 1 |

So the defect is specific to the runs that **failed**, not to the commit path in general. That is the
discriminator to chase: what differs between a run that commits per iteration and reaches completion,
and one that records progress boundaries and leaves everything dirty.

Two candidate explanations, neither verified:

- The early return in `commitProgressIteration` — `args.publishCompletion === false ||
  !existsSync(join(worktreePath, ".git"))` — suppressed it. `publishCompletion` is set per authored
  step (`publication-workflow-steps.ts:334,568`); whether implement linked steps pass `false` is
  unchecked.
- Those iterations never returned `progress` (e.g. each linked subspec settled `complete`), so the
  commit path was never reached and the work rode to the completion boundary uncommitted.

Note also that `boundary_committed` in a run log is a **state-store** boundary
(`store.commitCompletionBoundary`, SQLite), not a git commit — so a row reading
`boundary_committed` / `outcomeKind: "done"` is not evidence that anything was committed. That
naming cost two wrong diagnoses during the 2026-07-25 session.

Observed three times on 2026-07-25, each losing 20–70 minutes of agent work:

| run | boundaries reported | git commits | dirty files |
| --- | --- | --- | --- |
| intent-finalization attempt 2 | 3 steps, 2 recording `outcomeKind: "done"` / `runStatus: "completed"` | 0 | 13 |
| intent-finalization attempt 3 | 7 iterations across 3 steps | 0 | 13 |
| write-path-idle-output-watchdog | link-0 first pass `ok` (19.2 min) | 0 | 18 |

Each was recoverable only by an operator hand-committing the worktree, gating it, and opening a PR
by hand. Two of the three were recovered that way; the third is still stranded.

This makes an operator-facing promise unreliable. `v2/docs/operator-runbook.md` § Orphaned
non-terminal runs says "Committed iteration SHAs on the same branch also survive kill, daemon
reconcile, and resume while the branch exists; only in-flight edits before that iteration's git commit
may be lost." That guarantee is only as good as the iteration commits actually existing, and on these
three runs none did — so an operator following it would expect to recover work that is not there.

Related but distinct: `shrink-invocation-error-preserves-write-work` (#1836) commits write output
before the shrink pass — a single special case, not a general per-iteration commit.

## Decisions

- **Instrument before changing behavior.** Determine why `commitProgressIteration` produced no commit
  on the observed runs: log the `publishCompletion` value and the resolved iteration result kind at
  each boundary. Rules out re-implementing a feature that already exists, and rules out flipping the
  guard against a guessed cause.
- Whatever the cause, the invariant to hold is: a write iteration that produced file changes leaves
  them committed on the run branch, so a later failure loses at most the in-flight iteration.
- Do not rename or repurpose the `boundary_committed` log event here — its meaning (state-store
  boundary) is correct. Any naming change is separable and must not be bundled.
- Out of scope: whether `--reset-despite-dirty` should stash rather than discard.

## Acceptance criteria

- [ ] A run whose iterations produce file changes leaves a non-empty `git log <base>..HEAD` after a
      mid-run failure; a regression drives a failure after at least one progress iteration and fails
      against the observed behavior (zero commits).
- [ ] The reason the observed runs committed nothing is identified and recorded in the spec before the
      fix lands — either the `publishCompletion` guard or the iteration result kind, named explicitly.
- [ ] A run that completes normally still publishes the same result (no duplicate or orphaned commits
      in the PR), verified against an existing completion test.
- [ ] An iteration that changed no files creates no empty commit.
- [ ] `v2/docs/operator-runbook.md` § Orphaned non-terminal runs describes the guarantee that actually
      holds; today it promises surviving iteration SHAs that the observed runs did not have.

## Documentation updates

- `v2/docs/write-behavior.md` — when the write loop commits, and what a failure retains.
- `v2/docs/operator-runbook.md` — correct the iteration-SHA survival claim; recovery after a mid-run
  failure.
- `v2/docs/v1-behaviors.md` — record the changed commit cadence.
