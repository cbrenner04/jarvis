# Stuck-red completion stop (exit `10`)

Depends on `00-completion-ready-gate.md` and `01-red-loopback-iteration.md`.

## Problem

After a fix-up iteration (01) the completion gate (00) may still be red. The
existing completion-path stops do not fit: exit `4` (no-progress, `run.ts:1190`)
is keyed on a checkbox delta that cannot move at full completion and hides the
`ready` failure; exit `1` (error) is the very review-baseline behavior this work
removes from the completion path. The exit-code space `0–9` and `130` is fully
assigned (`mapExitCodeToReason`, `run.ts:682`), so a concrete new code must be
pinned here — this subspec is its only consumer. The captured `ready` text also
embeds non-deterministic content (timings, durations, deadline messaging,
absolute paths), so "did the failure change?" needs a defined comparison or the
stop never fires.

## Behavior

After a fix-up iteration with no stronger stop (blocker exit `7` / dirty exit
`6` from 01 take precedence), evaluate the re-run completion gate:

- **Green** → proceed into the post-completion phases (handled by 00/01).
- **Red, failure changed** → treat as progress: loop again into another fix-up
  iteration (01), bounded by `maxIterations`. The agent demonstrably moved the
  failure.
- **Red, failure unchanged** and no new checkbox and no new `## Blocker` → stop
  with the **stuck-red completion stop**: a new, recoverable exit code distinct
  from `4` and `1`.

**Exit code.** Pin **`10`** with reason string **`ready-stuck-red`** in
`mapExitCodeToReason` (`run.ts:682`). `10` is the next integer beyond the
assigned `0–9` band and is currently unused.

**Stop output.** On the stuck-red stop, stderr names:
1. the captured `bun run ready failed:\n<output>` text, and
2. a worktree pointer: the worktree path and `jarvis1 triage <worktree-name>`,

mirroring the existing exit-`6`/`7` recoverable-stop messages
(`run.ts:1133`/`1343`) so the operator can fix it by hand and rerun.

**Telemetry.** The stuck-red stop emits a harness telemetry record with
`exit_reason: "ready-stuck-red"` (analogous to the `no-progress`/`max-iterations`
harness records, `run.ts:722`/`1193`) so the stop is observable in telemetry and
the run summary.

### Failure-change comparison

Compare the previous fix-up iteration's captured `ready` failure to the current
one after **normalization** that strips the known non-deterministic spans, so
two genuinely-identical failures compare equal and an advanced failure compares
different. Normalize at least: absolute paths under the worktree, wall-clock
durations/timings, and the ready-script deadline/timeout messaging. Equal after
normalization → unchanged (stop); different → changed (loop).
`Deferred to first consumer: the exact normalization regex set — pin against the
real ready-script output when implementing, erring toward stripping more so the
stop is not suppressed by noise.`

### Baseline-gate reconciliation

With the completion gate (00) green before shrink/review on every proceeding
completion run, the review baseline gate's red→exit-`1` path (`review.ts:583`)
is unreachable for the completion case. Reconcile it so **no completion-path run
exits `1` solely because `ready` was red**: either leave it as an unreachable
backstop (documented as such) or soften it to warn-and-continue like the shrink
pre-gate. `Deferred to first consumer: leave-as-backstop vs. soften — pin when
implementing; whichever is chosen, the completion path's single response to red
`ready` is the loop-back, never exit `1`.` The shrink pre-gate already swallows
red on the completion path, so only the review baseline gate needs this
reconciliation.

## Decisions

- Stuck-red stop is exit `10` / `ready-stuck-red`, a concrete new code — rules
  out reusing exit `4` (checkbox-delta no-progress, which can't move at
  completion and hides the failure) or `1` (the behavior being removed).
- A changed `ready` failure body counts as progress and loops — rules out
  stopping the first time `ready` is still red when the agent advanced the
  failure.
- Failure comparison is normalized, not raw equality — rules out a raw compare
  that almost never reports "unchanged" (timings/paths differ each run), which
  would suppress the stop and burn to `maxIterations`.
- Baseline-gate red→exit-`1` is reconciled (backstop or softened) so the
  completion path never exits `1` on red `ready` — rules out two operator-
  visible red-`ready` completion behaviors.

## Tasks

- Add exit `10` with reason `ready-stuck-red` to `mapExitCodeToReason`
  (`run.ts:682`).
- After a fix-up iteration, on unchanged red with no new checkbox/blocker/dirty,
  stop with exit `10`, printing the captured `ready` failure plus the worktree
  path and `jarvis1 triage <worktree-name>`; on changed red, keep looping.
- Implement the normalized failure-change comparison.
- Emit the `ready-stuck-red` harness telemetry record on the stop.
- Reconcile the review baseline gate (`review.ts:583`) per the pinned
  leave-vs-soften decision so no completion-path run exits `1` solely because
  `ready` was red.
- Add/adjust tests in `v1/test/modes/patch/` covering: red→red unchanged stops
  with exit `10` (not `4`, not `1`) and surfaces the captured failure + worktree
  pointer; a changed failure body loops instead of stopping; the normalization
  treats a noise-only difference (changed timings/paths) as unchanged; no
  completion-path run exits `1` because `ready` was red.
- Update docs (below).

## Acceptance criteria

- [x] When `ready` is still red after a fix-up iteration with no new checkbox,
      no new `## Blocker`, and an unchanged (post-normalization) captured `ready`
      failure, the run stops with exit `10`.
- [x] Exit `10` maps to a recoverable stop reason (`ready-stuck-red`) distinct
      from no-progress (not `4`) and from the hard error (not `1`).
- [x] On that stop, stderr names the captured `ready` failure text and a
      worktree pointer (the worktree path and `jarvis1 triage <worktree-name>`).
- [x] A captured `ready` failure body that differs after normalization between
      fix-up iterations is treated as progress: the run loops again rather than
      stopping.
- [x] A noise-only difference (e.g. changed timings or absolute paths with an
      otherwise identical failure) is treated as unchanged and does not by itself
      keep the run looping.
- [x] The stuck-red stop emits a telemetry record carrying the
      `ready-stuck-red` reason so the stop is observable in telemetry/summary.
- [x] No completion-path run exits `1` solely because `ready` was red: the
      review baseline gate (`review.ts:583`) is left as an unreachable backstop
      or softened per the pinned decision.

## Documentation updates

- [x] `v1/docs/run-loop.md`: add the exit-`10` `ready-stuck-red` row to the
      stop-conditions table, document the stuck-red stop (captured failure +
      worktree pointer), the normalized changed-vs-unchanged failure test, and
      the baseline-gate disposition; add exit `10` to the list that prints the
      bounded output tail if applicable.
- [x] `v2/docs/v1-behaviors.md`: record the stuck-red completion stop (exit `10`,
      `ready-stuck-red`), the normalized failure-change test, and the baseline-
      gate reconciliation under the patch-mode catalog, with `Sources:` pointers
      (`run.ts:682`/`1190`, `review.ts:583`, `ready-gate.ts`).
