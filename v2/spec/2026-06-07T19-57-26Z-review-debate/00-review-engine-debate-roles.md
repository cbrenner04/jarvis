# 00 - Review engine: debate role sequence + injected executor seam

Add the debate role-shape to the shared review runner (`v1/src/modes/review/run.ts`, `types.ts`). Each configured review pass becomes one debate **cycle**: three read-only reviewer attempts in order — adversary, defender, judge — then one injected **executor** invocation driven by the judge's verdict. Mode-agnostic: role prompts, artifact storage, write boundary, and the executor body are the adapter's/caller's job (subspecs 01, 02). No new engine — reuse the `adapter` / `adapterForPass` seam.

## Decisions

- Roles are a fixed three-step sequence adversary → defender → judge per cycle; not configurable. — rules out exposing a role list as config (single operator, no caller needs it).
- The executor is injected into the runner (a runner option / adapter method), invoked once per cycle after the judge, not a fourth entry in the read-only pass loop. — rules out a write-enabled reviewer pass, which would let a reviewing-class role mutate the subject (self-vindication).
- The runner surfaces the current `role` on the pass/attempt context and does not own role prompts or artifact reading; the adapter selects the role prompt and reads the prior role's artifact. — rules out embedding mode-specific prompts in the engine.
- The verdict carrier is the judge's committed artifact, read by the executor via the adapter; the runner neither parses nor translates findings. — rules out the harness adjudicating materiality.
- Empty verdict → executor not invoked, no executor commit, via the existing no-change skip; no convergence/stop-on-empty logic. — rules out a materiality/convergence gate (philosophy lock).
- One configured pass = one cycle; cycle count is the existing review-pass setting (`resolveReviewPasses`), no new bounds. — rules out a separate debate-rounds knob.
- The verdict is per-cycle and does not carry forward; the next cycle's adversary reviews the changed subject fresh. — rules out threading prior verdicts into later cycles.
- Deferred to first consumer: debate-artifact storage location and how the runner exposes the prior role's artifact to the adapter — pin in subspec 01 (patch), the first caller.

## Task Checklist

- [ ] Extend `ReviewPassContext` / `ReviewAttemptContext` with the current debate role.
- [ ] Sequence each cycle as adversary → defender → judge read-only attempts through the existing adapter contract (boundary enforcement unchanged for reviewers).
- [ ] Add the injected executor seam invoked once per cycle with the judge's verdict; skip it on empty verdict via the existing no-change path.
- [ ] Keep quota fallback, blocker, telemetry, and interrupt handling working per role and for the executor.

## Documentation updates

- [ ] Update `v2/docs/v1-behaviors.md`: replace the "N identical passes" review description with the debate cycle (adversary → defender → judge → injected executor), verdict-per-cycle semantics, the read-only-reviewers / single-writer-executor split, and empty-verdict skip.

## Acceptance criteria

- [ ] For each configured cycle, `runReview` runs exactly three read-only reviewer attempts in order adversary, defender, judge, then invokes the injected executor once with that cycle's verdict.
- [ ] The current debate role is exposed to the adapter via the pass/attempt context.
- [ ] The executor seam is an injected runner option / adapter method, not a read-only pass; reviewer attempts cannot write the subject (existing write-boundary enforcement still runs for all three reviewers).
- [ ] An empty verdict skips the executor invocation and produces no executor commit (existing no-change skip path), with no convergence/materiality logic added.
- [ ] Cycle count resolves from the existing review-pass setting with no new bounds or config keys.
- [ ] Tests (in `v1/test/` or co-located) cover, with a stub adapter/executor: per-cycle role ordering, executor invoked with the verdict, empty-verdict executor skip, and read-only enforcement across all three reviewer roles.
- [ ] `v2/docs/v1-behaviors.md` reflects the debate role sequence, injected executor seam, and verdict-per-cycle semantics.
