# Resumed write loops retain consumed iterations

## Problem

`executeWriteLoop` initializes `iterationsConsumed` to zero on every invocation. A reconstructed directive reprompt can therefore receive a fresh budget and report a non-cumulative count after pause.

## Behavior

The write loop accepts an internal resumed-iteration seed, defaults it to zero for fresh and legacy callers, and uses it for admission, exhaustion, logs, and returned results. Guard, mutation, keystone, and ordinary iterations all consume the same remaining budget.

## Decision ledger

- Seed the shared `iterationsConsumed` accumulator instead of adding a directive-repair counter — rules out different post-resume budgets by reprompt kind.
- Default an absent seed to zero — rules out changing fresh-run behavior or requiring legacy callers to synthesize resume state.
- Count only settled iterations represented by the supplied seed; the resumed in-progress attempt keeps existing attempt reuse semantics — rules out double-counting the attempt re-entered after interruption.

## Tasks

- [ ] Add the resumed-iteration seed to write-loop input and initialize the existing accumulator from it.
- [ ] Cover remaining-budget admission, cumulative exhaustion, logs, results, fresh-run default, and resumed-attempt reuse.
- [ ] Update the durable docs listed below.

## Acceptance criteria

- [ ] `resumed write loop starts from its durable consumed count` in `v2/src/execution/write-loop.test.ts` fails against the pre-fix zero reset and permits only the remaining iterations under the existing ceiling.
- [ ] Terminal results and `loop_finished` report cumulative `iterationsConsumed`; an absent seed keeps fresh-run counts unchanged.
- [ ] Resuming an in-progress attempt does not increment the supplied count until that attempt settles.
- [ ] `v2/src/execution/write-loop.test.ts` — `resumed write loop starts from its durable consumed count`; Keystone checkpoint: resetting the resumed count to zero turns this pin red.
- [ ] `v2/src/execution/write-loop.test.ts` — `resumed in-progress attempt counts once when it settles`; Mutation checkpoint: inverting the resumed-attempt accounting guard double-counts or skips the attempt and turns this pin red.
- [ ] Every added or modified resume-accounting guard has an in-test `// @mutate` directive on the real source branch whose inversion turns its named regression red.
- [ ] `v2/docs/write-behavior.md` and `v2/docs/v1-behaviors.md` describe the cumulative shared iteration count and zero default.

## Documentation updates

- `v2/docs/write-behavior.md` — resumed seed, cumulative count, and shared exhaustion.
- `v2/docs/v1-behaviors.md` — resumed write-loop iteration accounting.
