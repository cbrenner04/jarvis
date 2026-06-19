# 00 - Review engine: debate role sequence + injected executor seam

Add the debate role-shape to the shared review runner (`v1/src/modes/review/run.ts`, `types.ts`). Each configured review pass becomes one debate **cycle**: three read-only reviewer attempts in order — adversary, defender, judge — then one injected **executor** invocation driven by the judge's verdict. Mode-agnostic: role prompts, artifact storage, write boundary, and the executor body are the adapter's/caller's job (subspecs 01, 02). No new engine — reuse the `adapter` / `adapterForPass` seam.

## Decisions

- The executor is injected (a runner option / adapter method), invoked once per cycle after the judge, not a fourth entry in the read-only pass loop. — rules out a write-enabled reviewer pass letting a reviewing-class role mutate the subject (self-vindication).
- The runner surfaces the current `role` on the pass/attempt context but owns no role prompts or artifact reading; the adapter selects the role prompt and reads the prior role's artifact. — rules out embedding mode-specific prompts in the engine.
- The verdict carrier is the judge's committed artifact, read by the executor via the adapter; the runner neither parses nor translates findings. — rules out the harness adjudicating materiality.
- Empty verdict → executor not invoked, no commit, via the existing no-change skip; no convergence/stop-on-empty logic. — rules out a materiality/convergence gate (philosophy lock).
- One configured pass = one cycle (the existing `resolveReviewPasses` setting), no new bounds. — rules out a separate debate-rounds knob.
- The shared default `modes.review.passes` drops from 2 to 1. — one debate cycle replaces the redundancy N shallow passes gave; >1 mostly manufactures findings ([[plan-refine-precision-amplifier]]). Operator can still bump it.
- The full debate trail does not carry forward, but the **prior cycle's verdict does**: the runner hands it to the next cycle's adversary as already-adjudicated context (find what the executor changed/newly broke, don't re-open settled findings). — rules out both full carry-forward and amnesiac re-litigation across cycles. The concrete per-mode filename is the adapter's job (subspecs 01/02).

## Task Checklist

- [x] Extend `ReviewPassContext` / `ReviewAttemptContext` with the current debate role.
- [x] Sequence each cycle as adversary → defender → judge read-only attempts through the existing adapter contract (boundary enforcement unchanged for reviewers).
- [x] Add the injected executor seam invoked once per cycle with the judge's verdict; skip it on empty verdict via the existing no-change path.
- [x] Expose the prior cycle's verdict to the next cycle's adversary (cross-cycle carry); within a cycle, expose the prior role's artifact to the next reviewer.
- [x] Drop the `modes.review.passes` default to 1 in `DEFAULT_CONFIG`.
- [x] Keep quota fallback, blocker, telemetry, and interrupt handling working per role and for the executor.

## Documentation updates

- [x] Update `v2/docs/v1-behaviors.md`: replace the "N identical passes" review description with the debate cycle (adversary → defender → judge → injected executor), the default of 1 cycle, prior-verdict-carry across cycles, the read-only-reviewers / single-writer-executor split, and empty-verdict skip.

## Acceptance criteria

- [x] For each configured cycle, `runReview` runs exactly three read-only reviewer attempts in order adversary, defender, judge, then invokes the injected executor once with that cycle's verdict.
- [x] The current debate role is exposed to the adapter via the pass/attempt context.
- [x] The executor seam is an injected runner option / adapter method, not a read-only pass; reviewer attempts cannot write the subject (existing write-boundary enforcement still runs for all three reviewers).
- [x] An empty verdict skips the executor invocation and produces no executor commit (existing no-change skip path), with no convergence/materiality logic added.
- [x] Cycle count resolves from the existing review-pass setting with no new bounds or config keys; the default is 1.
- [x] With >1 cycle, the prior cycle's verdict is passed to the next cycle's adversary; reviewers within a cycle still receive the prior role's artifact.
- [x] Tests (in `v1/test/` or co-located) cover, with a stub adapter/executor: per-cycle role ordering, executor invoked with the verdict, empty-verdict executor skip, prior-verdict carry into the next cycle's adversary, and read-only enforcement across all three reviewer roles.
- [x] `v2/docs/v1-behaviors.md` reflects the debate role sequence, injected executor seam, and verdict-per-cycle semantics.
