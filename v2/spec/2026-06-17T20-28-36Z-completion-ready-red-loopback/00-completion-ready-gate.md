# Completion `ready` gate before shrink/review

## Problem

At the completion transition `tryFinishSpecIfDone`
(`v1/src/modes/patch/run.ts:1332`) runs `bun run ready` more than once across
the post-completion phases, and the gates disagree on red:

- Shrink pre-gate (`v1/src/modes/patch/shrink.ts:298`) runs `ready` first and on
  red **warns and returns (skips shrink)** — it does not exit.
- Review baseline gate (`v1/src/modes/patch/review.ts:583`) is the **first** that
  **hard-exits `1`** on red, so finished work fails the run.
- When shrink/review are skipped (`passes: 0` or no implementation iterations),
  `maybeMarkReady` (`v1/src/modes/patch/pr.ts:238`) runs `ready` yet again; its
  red throw is caught in `tryFinishSpecIfDone` (`run.ts:1407`) and only warns.

So red `ready` reaches the operator inconsistently: an exit `1` from review
baseline, a silent skip from shrink, or an ungated `maybeMarkReady`. This
subspec lands a single completion `ready` gate ahead of all of them so there is
one place red `ready` is decided.

## Behavior

Run `bun run ready` as a **completion gate** in `tryFinishSpecIfDone`, **before**
shrink and review, on the same path the post-completion `ready` runs today:
`gitEnabled`, clean tree (the existing `worktreeCompletionBlocker` exit-`6`
check already runs first), and at least one implementation iteration. On
**green** the gate commits any `check:fix` output exactly as `runReadyAndCommit`
does today, then control proceeds into the post-completion phases unchanged
(shrink → review → `maybeMarkReady`).

The gate captures the `ready` failure text on red. The shared helper
`runReadyAndCommit` (`v1/src/ready-gate.ts`) *throws* an `Error` whose message is
`bun run ready failed:\n<stdout+stderr trimmed>` on red, before the `check:fix`
commit path; the completion gate **catches that Error** and derives the captured
failure from its message (no `check:fix` commit can occur on red because the
throw precedes it — this is inherent to the helper, not introduced here). On red
the gate yields a **loop-back signal** carrying the captured text, not an exit
code. Consuming that signal — looping into a fix-up iteration vs. stopping — is
specified in `01-red-loopback-iteration.md` and `02-stuck-red-stop.md`; this
subspec only adds the gate and its capture.

### Redundant `ready` invocations

Once this gate guarantees `ready` is green before shrink and review, the
shrink pre-gate, review baseline gate, and `maybeMarkReady` `ready` runs all
execute against an already-green tree on the completion path. The shrink
pre-gate's warn-and-skip and `maybeMarkReady`'s caught-warn paths are harmless
backstops and stay. The review baseline gate's red→exit-`1` path
(`review.ts:583`) is the one that turned finished work into a failed run;
reconciling it (leave as an unreachable backstop vs. soften) is
`02-stuck-red-stop.md`'s job, not this one. `Deferred to first consumer: whether
the gate reuses `runReadyAndCommit` directly or a capture-only variant — pin
when implementing 01.`

## Decisions

- Gate runs before shrink and review, not only inside one of them — rules out
  leaving the only completion `ready` inside review, where `passes: 0` skips it
  and red `ready` reaches `maybeMarkReady` ungated, or inside shrink, where red
  is silently swallowed.
- Gate catches the helper's existing `bun run ready failed:` throw rather than
  introducing a new failure channel — rules out a parallel capture path that
  would diverge from the text shrink/review already surface.

## Tasks

- Add a completion `ready` gate in `tryFinishSpecIfDone` on the
  `gitEnabled` / clean-tree / `implementationIterations > 0` path, before the
  shrink and review calls, that on green commits `check:fix` and proceeds, and on
  red captures the failure text and returns a loop-back signal (consumed in 01).
- Leave the shrink pre-gate and `maybeMarkReady` `ready` runs in place as
  green-path backstops.
- Add/adjust tests in `v1/test/modes/patch/` covering: green completion gate
  commits `check:fix` and proceeds into shrink/review unchanged; red completion
  gate captures the `bun run ready failed:` text and yields the loop-back signal
  instead of running shrink/review.
- Update docs (below).

## Acceptance criteria

- [ ] On the completion transition (`git: true`, clean tree, at least one
      implementation iteration), `bun run ready` runs once as a gate before the
      shrink and review phases.
- [ ] When that gate is green, any `check:fix` mutation is committed and pushed
      and the run proceeds into shrink → review → `maybeMarkReady`; operator-
      visible completion semantics (`spec complete`, draft→ready, PR URL) are
      unchanged from today on the green path.
- [ ] When that gate is red, the run does not run the shrink or review phases
      for the completion case and does not exit `1` from the review baseline
      gate; the gate captures the `bun run ready failed:\n<output>` text for the
      loop-back consumer.
- [ ] The shrink pre-gate and `maybeMarkReady` `ready` runs remain present and,
      on the green completion path, execute against an already-green tree.

## Documentation updates

- [ ] `v1/docs/run-loop.md`: document the completion `ready` gate placed before
      shrink/review, that it commits `check:fix` and proceeds on green, and that
      the pre-existing shrink pre-gate / review baseline / `maybeMarkReady`
      `ready` runs now sit behind it on the completion path.
- [ ] `v2/docs/v1-behaviors.md`: record the added completion `ready` gate and the
      reconciled post-completion `ready` invocations under the patch-mode
      catalog, with `Sources:` pointers (`run.ts:1332`, `shrink.ts:298`,
      `review.ts:583`, `pr.ts:238`, `ready-gate.ts`).
