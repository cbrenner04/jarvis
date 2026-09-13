---
name: repair-fence-refuses-every-path-on-a-fan-out-lane
---

# The ready-gate repair fence refuses a fan-out implement lane against the whole frozen v1 tree

## Problem

Two chained fan-out implement lanes settled `completion_commit_failed` with:

```text
Ready-gate repair stages path outside run diff and spec tree:
  v1/spec/completed/2026-06-14T17-01-11Z-prompt-mode-agent-fallback/verdict-patch.md, … (~305 paths)
```

That is the **entire** tracked set of `v1/spec/completed/**/verdict-*.md` files — 305 of them — in the frozen `v1/` tree, which no v2 lane can legitimately touch. The lanes' own work was complete and their gates were otherwise fine.

**This is a regression.** Full `full-review` pipelines have completed unattended recently — [#3741](https://github.com/cbrenner04/jarvis/pull/3741) (2026-09-09, seed → ready in 39 minutes) and [#3807](https://github.com/cbrenner04/jarvis/pull/3807) (2026-09-12, seed → PR with gate approvals the only operator action). On 2026-09-13, **zero of five** implement lanes flipped themselves to ready.

## What has been ruled out

- **Not load.** Reproduces independently of concurrency; the two affected lanes failed identically.
- **Not a fixer rewriting those files.** On a fresh checkout of `main`, repo-wide `biome check --write .` and `bun run reflow:md` each leave the tree **0 files dirty**. Neither touches the v1 verdict corpus.
- **Not a stale base ref.** Those files last changed in `07e770208` (2026-06-19) and have been on `main` for three months, so no plausible base makes them appear in a `base…HEAD` diff.
- **Not actual staged state.** At settle time the refused paths are in neither lane's `merge-base…HEAD` diff, not present in `git diff --cached` on either worktree, and not dirty in `git status`.

## Discriminator falsified (2026-09-13, same session)

The section below proposed fan-out as the discriminator on 2 refusing lanes vs 1 non-refusing. The **third fan-out lane then settled `ready_gate_out_of_scope`**, not the fence refusal — so fan-out does not predict this shape, and the hypothesis is 2 of 3 at best. Read the next section as the observation that motivated the seed, not as a finding. What still holds: two lanes refused against the entire 305-file frozen-`v1` verdict corpus, those paths were absent from both lanes' diff, index and worktree, and resume replays the stored refusal instantly instead of re-deriving. See [[out-of-scope-probe-blames-main-for-the-lane-s-own-regression]] for what that third lane did instead.

## The discriminator (falsified — kept for context)

The lanes that hit this are the two **fan-out** lanes of one pipeline — the shape whose spec lives in a *prior stage's* worktree and is copied into the implement worktree. The same pipeline's **single-lane** chained implement (`guard-flip-derivation-crash-is-contained`) reached its gate in the same session and did **not** hit the fence; the third fan-out lane never reached the gate (it was refused for gate-slot contention first). So: every fan-out lane that reached the gate refused; the non-fan-out lane that reached the gate did not. Small sample (2 vs 1), but it is the sharpest signal available and is where diagnosis should start.

The suspected mechanism is that the fence's allowset — `base…HEAD` diff ∪ spec tree, with its untracked seam stubbed to empty (`REPAIR_FENCE_ALLOWSET_SEAMS = { gitUntracked: async () => "\0" }`, `write-loop.ts:660`) — collapses for a fan-out lane because `specPath` resolves outside the implement worktree, leaving almost nothing allowed so that whatever the repair touches reads as "outside". **Confirm this before building anything**; the refused list not matching any on-disk state is unexplained by that hypothesis alone.

## Resume cannot clear it

Both rows advertise `retryable: true` / `nextAction: "resume"`, and `jarvis run resume` returns `internal_error` **instantly** — far too fast to have re-run a gate — replaying the stored refusal verbatim. This is #3040's dead-end (repair refused for out-of-diff paths with a retryable that can never succeed) presenting with #3395's lying-row shape. Both lanes had to be hand-finished.

## Decisions

- Diagnose why the allowset collapses on a fan-out lane **before** changing the fence. The fence refusing is correct behaviour if the allowset is right; the defect is the allowset, not the guard. Rules out widening the fence to make the symptom go away.
- On refusal the fence records its **derived allowset and the inputs it derived from** (`baseRef`, `specPath`, markdown roots, whether provenance was reconstructed), not just the refused paths. Today the row names only what was refused, so the failure is undiagnosable without reading source — the same gap #3423 reports for the sibling "could not derive allowed paths" message. Rules out another undiagnosable settlement.
- A row whose fence refusal is not clearable by re-running must not advertise `nextAction: "resume"`, and `run resume` must never answer `internal_error` on a row it admits. Rules out the fixed point.
- Scope is the repair fence allowset derivation and its settlement honesty. No change to what the fence forbids. Rules out relaxing the frozen-`v1` boundary.

## Acceptance criteria

- [ ] A test drives the ready-gate repair fence for a chained fan-out implement lane whose spec lives on a prior stage's worktree and proves the derived allowset contains that lane's own changed paths and spec tree; it fails against the current derivation.
- [ ] A test proves a fence refusal records the derived allowset and its derivation inputs on the run, sufficient to explain the refusal without reading source.
- [ ] A test proves a lane whose repair touches only its own diff and spec tree publishes rather than refusing.
- [ ] A test proves a fence-refused row either admits `run resume` and re-derives, or reports a non-resumable `nextAction`; `internal_error` on an admitted row is unreachable.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — allowset derivation for chained and fan-out lanes, and what a refusal records.
- `v2/docs/operator-runbook.md` — a fence refusal naming paths absent from the worktree is an allowset defect, not operator debris; resume does not clear it.
