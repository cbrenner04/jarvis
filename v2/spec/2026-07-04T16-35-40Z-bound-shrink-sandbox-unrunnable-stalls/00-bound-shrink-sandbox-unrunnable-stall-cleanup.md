# Bound shrink sandbox-unrunnable stall cleanup

## Problem

`v1/test/modes/patch/shrink.sandbox-unrunnable.test.ts` owns real `git`
subprocesses and imported idle-hang fixtures. When one of those seams stalls,
the file can keep the CI `Test` job open instead of failing red quickly.

## Decisions

- Bound the shrink file's real `git` subprocesses in test-owned helpers — rules out bare synchronous `git` calls on this path that can block the file forever.
- Reap shrink-file hang-fixture descendants on timeout and failure paths, not only normal teardown — rules out relying on process exit or best-effort `afterEach` cleanup alone.
- Fail the owning test when the bound fires — rules out masking the hang with a workflow-level CI timeout or a skipped-case escape hatch.
- Keep the defensive bound even if the exact upstream CI trigger stays unpinned — rules out waiting for a deterministic reproducer before removing the latent file hang.

## Task checklist

- [ ] Characterize the shrink file's stall path enough to identify the real `git` subprocesses and imported idle-hang fixtures it owns.
- [ ] Replace bare real-`git` calls on that path with bounded helpers that fail the test quickly and identify the timed-out command.
- [ ] Extend the shrink file's hang-fixture ownership and cleanup so timeout and failure paths reap spawned descendants before the test returns.
- [ ] Add or update shrink sandbox-unrunnable coverage so a stalled shrink-owned subprocess or hang fixture exits as a failing test with bounded cleanup instead of leaving the file running.
- [ ] Update the durable docs in this slice.

## Acceptance criteria

- [ ] `v1/test/modes/patch/shrink.sandbox-unrunnable.test.ts` turns a stalled shrink-owned real-`git` subprocess or imported idle-hang path into a failing test with bounded completion, so the file exits red instead of hanging the CI `Test` job.
- [ ] When that bound fires, the shrink file reaps the hang-fixture process tree it spawned before the test returns.
- [ ] The failing output names the timed-out shrink-owned operation closely enough to distinguish a bounded test failure from an assertion failure elsewhere in the file.
- [ ] `v1/docs/operator-runbook.md` records the post-fix operator behavior: shrink `*.sandbox-unrunnable.test.ts` stalls fail boundedly, and follow-up guidance is to rerun or debug a red test rather than wait on a wedged job.
- [ ] `v2/docs/v1-behaviors.md` records that shrink sandbox-unrunnable stalls now fail the file boundedly instead of hanging the `Test` job.

## Documentation updates

- `v1/docs/operator-runbook.md` — update the shrink `*.sandbox-unrunnable.test.ts` gotcha/retry guidance to the bounded-failure behavior.
- `v2/docs/v1-behaviors.md` — record the new bounded-failure behavior for shrink sandbox-unrunnable stalls.
