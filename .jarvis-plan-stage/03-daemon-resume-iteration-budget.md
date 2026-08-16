# Daemon resume restores the write iteration ceiling

## Problem

Daemon reconstruction has neither the authored `maxIterations` nor the prior settled-iteration count: workflow snapshots omit the ceiling and resume ignores the latest terminal count. Restoring a directive prompt alone can therefore grant more iterations than the original run allowed.

## Behavior

Daemon resume restores the authored write-step ceiling and supplies the newest durable terminal `iterationsConsumed` value to the resumed loop. A paused directive repair consumes only the original budget's remainder.

## Decision ledger

- Round-trip `maxIterations` in the workflow step snapshot and restore it during daemon reconstruction — rules out substituting the default for an authored ceiling.
- Source the resumed count from the newest terminal `loop_finished.iterationsConsumed`, not attempt-row cardinality — rules out counting unfinished attempts or unrelated history.
- Legacy snapshots without `maxIterations` retain the existing default, and tails without a terminal count supply zero — rules out a state migration for old runs.

## Prerequisites

- The resumed-iteration seed lands in subspec 02 before daemon reconstruction supplies it.

## Tasks

- [ ] Carry `maxIterations` through workflow snapshot creation, equality, storage, and reconstruction.
- [ ] Recover the latest terminal consumed count and pass both budget fields on daemon resume.
- [ ] Cover directive-reprompt exhaustion at the cumulative ceiling and legacy fallbacks.
- [ ] Update the durable docs listed below.

## Acceptance criteria

- [ ] `daemon resume preserves directive-reprompt iteration ceiling and consumed count` in `v2/src/daemon/daemon-resume.test.ts` starts from a nonzero terminal count under an authored ceiling, fails against the pre-fix reset/default, and reaches exhaustion without an extra agent invocation.
- [ ] Workflow snapshots round-trip authored `maxIterations`; daemon reconstruction uses it with the newest terminal `iterationsConsumed` value.
- [ ] Legacy snapshots without `maxIterations` retain the default ceiling, and log tails without a terminal count start at zero.
- [ ] `v2/src/daemon/daemon-resume.test.ts` — `daemon resume preserves directive-reprompt iteration ceiling and consumed count`; Keystone checkpoint: dropping either reconstructed budget field turns this pin red.
- [ ] `v2/src/daemon/daemon-resume.test.ts` — `daemon resume uses the newest terminal consumed count`; Mutation checkpoint: inverting newest-terminal selection grants or removes iterations and turns this pin red.
- [ ] `v2/src/daemon/daemon-resume.test.ts` — `daemon resume retains legacy iteration-budget defaults`; Mutation checkpoint: inverting the legacy fallback guard turns this pin red.
- [ ] Every added or modified terminal-selection or legacy-fallback guard has an in-test `// @mutate` directive on the real source branch whose inversion turns its named regression red.
- [ ] `v2/docs/write-behavior.md` and `v2/docs/v1-behaviors.md` describe restored ceilings, cumulative counts, exhaustion, and legacy fallback.

## Documentation updates

- `v2/docs/write-behavior.md` — daemon-restored ceiling, consumed count, and exhaustion.
- `v2/docs/v1-behaviors.md` — directive-reprompt budget continuity across daemon resume.
