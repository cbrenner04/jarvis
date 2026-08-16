# Daemon resume restores the write iteration budget

## Problem

Recovering only `loop_finished.iterationsConsumed` can lag a committed progress boundary after a crash and grant a resumed directive repair a fresh or extra iteration.

## Behavior

Daemon resume derives the settled consumed count from authoritative durable state aligned with each committed progress boundary and supplies it with the snapshot-restored ceiling. A routed paused directive repair consumes only the original budget remainder, even after interruption.

## Decision ledger

- Recover the newest authoritative settled count aligned with committed progress, not only a terminal `loop_finished` tail — rules out crash windows granting an extra invocation.
- Pass that count and the restored normalized ceiling together to the resumed loop — rules out independent budgets for guard, mutation, and keystone repairs.
- Use zero only when legacy durable state has no settled count — rules out a migration for old runs.
- Exercise linked-index daemon resume — rules out a synthetic exact-`implement` path that skips active-subspec reconstruction.

## Prerequisites

- The resumed-iteration seed lands in subspec 03 and snapshot ceiling persistence lands in subspec 04 before daemon reconstruction supplies both values.

## Tasks

- [ ] Recover the authoritative durable settled count at committed progress boundaries and pass it with the restored ceiling on daemon resume.
- [ ] Cover directive-reprompt exhaustion at the cumulative ceiling, interruption after committed progress, newest-count selection, and legacy fallback in routed linked-index runs.
- [ ] Update the durable docs listed below.

## Acceptance criteria

- [ ] `daemon resume preserves directive-reprompt iteration ceiling and consumed count` in `v2/src/daemon/daemon-resume.test.ts` uses an `implement~link-N` step, starts from a nonzero committed count under an authored ceiling, fails against pre-fix reset/default behavior, and reaches exhaustion without an extra agent invocation.
- [ ] `daemon resume recovers consumed iterations at the latest committed progress boundary` in `v2/src/daemon/daemon-resume.test.ts` interrupts after durable progress before any lagging terminal record and proves resume neither receives a fresh budget nor invokes an extra iteration.
- [ ] `daemon resume uses the newest authoritative consumed count` in `v2/src/daemon/daemon-resume.test.ts` proves newer unrelated or unfinished history cannot replace the count aligned with the active linked step's committed progress.
- [ ] `daemon resume retains legacy iteration-budget defaults` in `v2/src/daemon/daemon-resume.test.ts` proves a legacy snapshot without a ceiling and a tail without settled progress start from the default and zero.
- [ ] The routed integration fixture proves authored-step matching and active-subspec artifact reconstruction, then proves the restored ceiling and count constrain the same resumed run.
- [ ] `v2/src/daemon/daemon-resume.test.ts` — `daemon resume preserves directive-reprompt iteration ceiling and consumed count`; Keystone checkpoint: dropping either reconstructed budget field turns this pin red.
- [ ] `v2/src/daemon/daemon-resume.test.ts` — `daemon resume uses the newest authoritative consumed count`; Mutation checkpoint: inverting newest-authoritative-count selection grants or removes iterations and turns this pin red.
- [ ] `v2/src/daemon/daemon-resume.test.ts` — `daemon resume recovers consumed iterations at the latest committed progress boundary`; Mutation checkpoint: using only `loop_finished` turns this pin red.
- [ ] `v2/src/daemon/daemon-resume.test.ts` — `daemon resume retains legacy iteration-budget defaults`; Mutation checkpoint: inverting the legacy fallback guard turns this pin red.
- [ ] Every added or modified progress-boundary, terminal-selection, linked-step, or legacy-fallback guard has an in-test `// @mutate` directive on the real source branch whose inversion turns its named regression red.
- [ ] `v2/docs/write-behavior.md` and `v2/docs/v1-behaviors.md` describe restored ceilings, authoritative cumulative counts, shared exhaustion, interruption safety, and legacy fallback.

## Documentation updates

- `v2/docs/write-behavior.md` — resumed seed, daemon-restored ceiling, authoritative consumed count, exhaustion, and legacy fallback.
- `v2/docs/v1-behaviors.md` — directive-reprompt budget continuity across daemon resume.
