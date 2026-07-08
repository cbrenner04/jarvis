## Verdict — required refinements

### 1. `daemon-resume.test.ts` must be an in-process handler test, not a socket round-trip

The subspec's task checklist explicitly calls for an "in-process handler test" that "supplements, does not replace, socket admission coverage" in `daemon-start-list.test.ts`. The current file drives the request over a real Unix socket via `startIpcServer`/`connectIpcClient`, which is the socket-admission pattern the checklist says this test supplements, not duplicates. `v2/docs/test-writing.md` names socket-based tests as a defect unless they fall into a narrow set of grandfathered exemptions, and this new test is not one of them.

**Required outcome:** Rewrite `daemon-resume.test.ts` to invoke the run-control handler factory's returned handlers directly (in-process), proving the paused-run rejection, executor-not-invoked, and status-preserved behavior without going through the IPC socket transport. This must remain in addition to (not a replacement for) the existing `daemon-start-list.test.ts` paused-admission coverage.

### 2. Seed 02 must drop its now-duplicate resume-placeholder bullet

The spec's coordination decision states that whichever subspec lands first owns the resume-placeholder work, and the other drops its bullet without re-adding `not_implemented`. This subspec has landed the implementation (daemon.ts change, new/updated tests, docs), so `v2/spec/seeds/02-v2-dead-weight-purge.md` owes removal of its "resume placeholder → explicit rejection" bullet, but it currently still lists it.

**Required outcome:** Remove the stale resume-placeholder bullet from `v2/spec/seeds/02-v2-dead-weight-purge.md` so the seed no longer duplicates work this subspec has already completed.