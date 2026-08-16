# Resumed write loops retain consumed iterations

## Problem

`executeWriteLoop` initializes `iterationsConsumed` to zero on every invocation, so a correctly recovered resume seed can still be discarded or double-count an interrupted attempt.

## Behavior

The write loop accepts an internal settled-iteration seed, defaults it to zero for fresh and legacy callers, and uses it for admission, exhaustion, logs, and returned results. A resumed in-progress attempt increments only when it settles.

## Decision ledger

- Seed the shared accumulator instead of adding a directive-repair counter — rules out different budgets by reprompt kind.
- Default an absent seed to zero — rules out changing fresh-run behavior.
- Count only settled iterations represented by the seed — rules out double-counting the attempt re-entered after interruption.

## Tasks

- [ ] Add the settled-iteration seed to write-loop input and initialize the existing accumulator from it.
- [ ] Cover remaining-budget admission, cumulative exhaustion, logs, results, fresh-run default, and resumed-attempt reuse.

## Acceptance criteria

- [ ] `resumed write loop starts from its durable consumed count` in `v2/src/execution/write-loop.test.ts` fails against the pre-fix zero reset and permits only the remaining iterations under the existing ceiling.
- [ ] Terminal results and `loop_finished` report cumulative `iterationsConsumed`; an absent seed keeps fresh-run counts unchanged.
- [ ] `resumed in-progress attempt counts once when it settles` in `v2/src/execution/write-loop.test.ts` proves the supplied count is not incremented before that attempt settles and is incremented exactly once afterward.
- [ ] `v2/src/execution/write-loop.test.ts` — `resumed write loop starts from its durable consumed count`; Keystone checkpoint: resetting the resumed count to zero turns this pin red.
- [ ] `v2/src/execution/write-loop.test.ts` — `resumed in-progress attempt counts once when it settles`; Mutation checkpoint: inverting the resumed-attempt accounting guard double-counts or skips the attempt and turns this pin red.
- [ ] Every added or modified resume-accounting guard has an in-test `// @mutate` directive on the real source branch whose inversion turns its named regression red.

## Documentation updates

- None; daemon durability and operator-facing accounting are documented in subspec 05.
