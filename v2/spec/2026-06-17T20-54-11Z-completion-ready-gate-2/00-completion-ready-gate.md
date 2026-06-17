# Run `ready` at the completion transition, reuse on unchanged tree

## Problem

`jarvis1 run` never runs `bun run ready` during the implementation loop, so the
first verification happens in a post-completion gate. Each gate runs
`runReadyAndCommit` independently. The gates and when they fire:

- shrink pre-gate (`shrink.ts:298`) — when `git: true` and ≥1 implementation iteration.
- review baseline gate (`review.ts:575`) — when review runs (`passes > 0`, default `1`).
- review final gate (`review.ts:831`) — same condition; runs after the debate cycles.
- `maybeMarkReady` (`pr.ts:238`) — only when review does *not* run, from one of two sites (see Behavior).

On the default-review common path (`passes ≥ 1`, no-op shrink, unchanged tree)
**three** gates run on the same commit (shrink pre-gate, review baseline, review
final), and `maybeMarkReady` does not run there. The shrink pre-gate and review
baseline re-prove an already-green tree back-to-back; the review-final tree is
typically advanced by `review:` commits, so it is a separate run, not a
redundant one (see Behavior). On the review-disabled path (`passes 0`) the
shrink pre-gate and `maybeMarkReady` are the two gates.

This is harness work in the v1 engine (`v1/src/modes/patch/run.ts`,
`shrink.ts`, `review.ts`, `pr.ts`, `v1/src/ready-gate.ts`). Completion is still
measured by checkbox transitions; this slice only moves *where* the first
`ready` runs and removes the redundant re-runs on an unchanged tree.

The configured default review passes is `1` (`v1/src/config.ts`), but
`v1/docs/run-loop.md` currently states `2`; the documentation update corrects
that figure rather than inheriting it.

## Behavior

**Completion gate.** At the completion transition — the tick that empties the
active subspec's checklist (zero unchecked boxes) on a run that ran ≥1
implementation iteration — run `bun run ready` once, harness-side, zero agent
tokens, via the existing `runReadyAndCommit` path. The gate runs only when
`git: true`. `runReadyAndCommit` already commits and pushes any `check:fix`
mutation, so this run may itself advance HEAD with a `chore: apply pre-ready
check:fix` commit before the worktree settles clean.

The gate is bounded by the same `implementationIterations > 0` guard the
shrink/review phases use. On the zero-implementation-iteration completion path
(the checklist was already empty on entry, e.g. checkbox-only first-iteration
completion), shrink and review are skipped, the lone `maybeMarkReady` runs
standalone, and there is no redundancy to remove: the completion gate does not
run there and that path is unchanged.

**Recording.** Record an in-process result (green, or red per the Red path
below) *after* `runReadyAndCommit` returns and the worktree is clean, keyed on
the resulting (post-`check:fix`-commit) HEAD sha. "Unchanged tree" everywhere
below means: same HEAD via `git rev-parse HEAD` and a clean worktree via `git
status --porcelain` empty — the same notions the surrounding gates already read,
so the gate's sense of unchanged cannot diverge from them.

**Two `maybeMarkReady` sites.** There are two call sites, both guarded so they
fire only when neither shrink nor review will run:

- in-iteration, on the completing iteration (`run.ts:1089`), guarded by
  `!willRunReview && !willRunShrink`;
- in the completion routine `tryFinishSpecIfDone` (`run.ts:1402`), in the
  `else if (gitEnabled)` branch reached only when review is skipped.

On the `passes 0` path the in-iteration site fires first. So the completion gate
must run before it and record the result, and that site (like the others) must
reuse the recorded result rather than run `ready` again — otherwise a gate placed
only in `tryFinishSpecIfDone` cannot dedupe the earlier in-iteration run.

**Gate reuse.** The post-completion gates stop running `ready` unconditionally.
Each checks the recorded result first: when the tree is unchanged since the
recording the gate reuses it and skips its own `ready` execution; when the tree
changed (e.g. a `shrink:` commit landed, or its own `check:fix` commit) it
re-runs `ready` and re-records. Reuse short-circuits **only** the `bun run ready`
execution: `maybeMarkReady` and the review final gate still run `gh pr ready`
(the draft→ready transition), so a reuse path never leaves the PR draft.

Gates affected: the shrink pre-gate, the review baseline gate, the review final
gate, and both `maybeMarkReady` sites. In practice the **review final gate
almost always re-runs**: the debate cycles commit `review: actuator` and per-role
changes whenever review does any work, advancing HEAD before the final gate, so
its tree matches the record only in the degenerate no-op-review case. It is not
counted among the gates this slice eliminates on the common path.

Net on the default-review common path: the completion gate plus the review final
gate run, while the shrink pre-gate and review baseline reuse — one `ready` plus
the final-gate run, down from three.

**Red path.** When the completion-transition `ready` is red it throws. The gate
catches that throw, records nothing, and falls through to today's
post-completion behavior; the run is not aborted by the gate. "No behavior
change on the red path" applies to the downstream gates only — they run `ready`
exactly as today. The completion gate's own red handling is new: a red
completion gate followed by a red downstream gate would pay two red `ready` runs
where today there is one. To avoid that regression, also record the **red**
verdict keyed to the same (unchanged) tree, so the first downstream gate reuses
the red result and the count stays at one red `ready`. Red loop-back semantics
(stop reason, looping the agent back) remain out of scope either way. This slice
does not auto-tick or judge acceptance-criteria content.

## Decisions

One harness-side `ready` at the completion transition, reused downstream — rules out today's redundant per-gate re-runs on an unchanged tree, and rules out pushing `bun run ready` per-iteration onto the agent.
Reuse is keyed on tree state (HEAD sha + clean worktree), not a bare boolean — rules out reusing a stale green result after shrink or a `check:fix` commit mutates the tree.
The green result is recorded on the post-`check:fix`-commit HEAD, after `runReadyAndCommit` returns clean — rules out keying on the pre-commit HEAD, which the immediately-following shrink pre-gate would see as changed, re-running and defeating the slice on its target path.
Record the red verdict too, keyed to the same tree, so a downstream gate reuses it — rules out a green-only record that leaves a red completion gate plus a red downstream gate paying two red `ready` runs where today there is one.
The completion gate is bounded by `implementationIterations > 0`, matching shrink/review — rules out running a redundant gate on the zero-iteration path, where the lone `maybeMarkReady` already runs standalone with nothing to dedupe.
The completion gate runs before the in-iteration `maybeMarkReady` site and that site reuses the record — rules out placing the gate only in `tryFinishSpecIfDone`, which cannot dedupe the earlier in-iteration `ready` on the `passes 0` path.
Reuse the existing `runReadyAndCommit` capture, not a second runner — rules out a bespoke ready runner that could drift from the `check:fix` commit/push semantics.
Reuse short-circuits only the `bun run ready` execution, not `gh pr ready` — rules out a reuse path that skips the draft→ready transition and leaves the PR draft.
Red at the completion gate preserves today's downstream post-completion behavior — rules out coupling this slice to red loop-back so it can land alone.
The completion gate runs only under `git: true` — rules out a clean-tree key in loop-only mode, where there are no commits, no PR, and no post-completion gates to reuse it.

Deferred to first consumer: whether the recorded result survives across separate `jarvis1 run` invocations — pin when a caller needs cross-run reuse (this slice records in-process only).

## Tasks

- Add an in-process result record (green or red) keyed on the post-`check:fix` HEAD sha + clean worktree, captured after the completion-transition `runReadyAndCommit` returns.
- Run `runReadyAndCommit` once at the completion transition, under `git: true` and bounded by `implementationIterations > 0`, before the shrink pre-gate, the review baseline gate, and both `maybeMarkReady` sites (`run.ts:1089` in-iteration, `run.ts:1402` in `tryFinishSpecIfDone`); do not run it on the zero-iteration path.
- Catch a red completion-transition `ready`: record the red verdict keyed to the unchanged tree and fall through to the existing post-completion gates without aborting the run.
- Guard the shrink pre-gate, review baseline gate, review final gate, and both `maybeMarkReady` sites to reuse the recorded result (skipping only the `ready` execution, not `gh pr ready`) when the tree is unchanged, and re-run `ready` otherwise.
- Define "unchanged tree" via `git rev-parse HEAD` + empty `git status --porcelain`, matching the surrounding gates.
- Update `v1/docs/run-loop.md` and `v2/docs/v1-behaviors.md` per Documentation updates.

## Acceptance criteria

- [ ] On a `git: true` patch run with `passes ≥ 1` that completes with ≥1 implementation iteration, a no-op shrink, and an unchanged tree, the shrink pre-gate and review baseline gate reuse the completion-gate result and run no `ready` of their own; only the completion gate and the review final gate run `bun run ready` (two runs, down from three today).
- [ ] On a `git: true` run with `passes 0` (review disabled), ≥1 implementation iteration, and a no-op shrink, `bun run ready` runs exactly once — at the completion gate — and the in-iteration `maybeMarkReady` reuses that result instead of running `ready` again.
- [ ] The completion gate runs at the completion transition (when the active subspec's last unchecked box is ticked, reaching zero unchecked boxes) and consumes zero agent tokens.
- [ ] The completion gate runs through the existing `runReadyAndCommit` path: any `check:fix` mutation is committed and pushed before the run proceeds.
- [ ] After the completion gate succeeds, a post-completion gate whose tree is unchanged (same `git rev-parse HEAD`, empty `git status --porcelain`) skips its own `ready` execution and reuses the recorded result.
- [ ] When the completion gate itself lands a `chore: apply pre-ready check:fix` commit, the immediately-following shrink pre-gate still reuses (tree unchanged since the post-commit record) rather than re-running.
- [ ] A post-completion gate whose tree changed since the record (e.g. a `shrink:` commit landed, or `review:` commits advanced HEAD before the review final gate) re-runs `bun run ready` instead of reusing.
- [ ] Reuse short-circuits only the `bun run ready` execution: `maybeMarkReady` and the review final gate still run `gh pr ready`, so a reuse path never leaves the PR draft.
- [ ] When the completion-transition `ready` is red, the gate records no green result, does not abort the run, and the downstream post-completion gates run `ready` exactly as today; a red completion gate followed by a red downstream gate runs `ready` once total (the red verdict is reused), not twice.
- [ ] The completion gate does not run when effective `git` is `false`, nor on the zero-implementation-iteration completion path.
- [ ] Completion is still measured by checkbox transitions only; the gate does not auto-tick or judge acceptance-criteria content.
- [ ] `bun run typecheck` and `bun test` pass.

## Documentation updates

- `v1/docs/run-loop.md`: describe the single completion-transition `ready` gate and the unchanged-tree reuse by the post-completion phases (shrink pre-gate, review baseline, both `maybeMarkReady` sites), noting the review final gate participates in the same tree check but in practice re-runs because `review:` commits advance HEAD. Replace the per-gate unconditional re-run description. Note the green-path-only scope and the zero-iteration / `git: false` exclusions. Correct the review-passes default from `2` to `1` (the configured value). Confirm the exit-6 narrative's post-readiness clean-worktree guarantee still holds with the completion gate as an additional origin of the auto-handled `chore: apply pre-ready check:fix` commit.
- `v2/docs/v1-behaviors.md`: record the completion-transition `ready` gate and the tree-keyed gate reuse as the v1 parity baseline, updating the review-phase entry (baseline `bun run ready` → reuse-or-run) and the shrink entry (pre-shrink gate → reuse-or-run), and noting the review final gate re-runs in practice. Keep the documented default of `1` consistent.
