# Bound shrink sandbox-unrunnable stall cleanup

## Problem

`v1/test/modes/patch/shrink.sandbox-unrunnable.test.ts` owns real `git`
subprocesses and imported idle-hang fixtures. When one of those seams stalls,
the file can keep the CI `Test` job open instead of failing red within the same
sub-5-second ceiling already exercised by the shrink idle-watchdog coverage.

## Decisions

- Route the landed slice under `v1/spec/...`, not `v2/spec/...` — rules out leaving mixed v1 shipping-surface work under the v2 spec tree.
- Bound every `execSync("git ...")` call owned by `v1/test/modes/patch/shrink.sandbox-unrunnable.test.ts`, including `setupShrinkRepo()` and later shrink-only assertion/setup helpers — rules out protecting only the reproduced hang site while other shrink-owned real-`git` calls stay able to block the file forever.
- Keep the bounded failure under 5 seconds wall-clock, including cleanup, to match the file's existing shrink idle-watchdog ceiling — rules out materially slower "still bounded" alternatives that keep CI stuck long enough to be operationally equivalent to a wedge.
- Treat the shrink-owned cleanup set as every child process the file spawns on this path, including the timed-out real-`git` child and imported idle-hang descendants — rules out reaping only fixture shells while leaving the timed-out subprocess tree behind.
- Reap that shrink-owned process set on timeout and non-timeout failure paths, not only normal teardown — rules out relying on process exit or best-effort `afterEach` cleanup alone.
- Fail the owning test when the bound fires — rules out masking the hang with a workflow-level CI timeout or a skipped-case escape hatch.
- Keep the defensive bound even if the exact upstream CI trigger stays unpinned — rules out waiting for a deterministic reproducer before removing the latent file hang.

## Task checklist

- [ ] Move this slice into the `v1/spec/...` tree before merge.
- [ ] Replace every shrink-owned `execSync("git ...")` call in `v1/test/modes/patch/shrink.sandbox-unrunnable.test.ts` with a bounded test helper that fails within 5 seconds wall-clock and names the timed-out command.
- [ ] Extend the shrink file's owned-process tracking so timeout and non-timeout failure paths reap the full shrink-owned child set, including the timed-out real-`git` child and imported idle-hang descendants, before the test returns.
- [ ] Add or update shrink sandbox-unrunnable coverage so a stalled shrink-owned real-`git` subprocess or imported hang fixture fails the owning test within that sub-5-second bound instead of leaving the file running.
- [ ] Update the durable docs in this slice.

## Acceptance criteria

- [ ] `v1/test/modes/patch/shrink.sandbox-unrunnable.test.ts` turns any shrink-owned `execSync("git ...")` call or imported idle-hang path it starts into a failing test that completes in under 5 seconds wall-clock, including cleanup, so the file exits red instead of hanging the CI `Test` job.
- [ ] On timeout and on other failure exits from that path, the shrink file reaps the full shrink-owned spawned process set before the test returns, including the timed-out real-`git` child and imported hang-fixture descendants.
- [ ] The failing output names the timed-out shrink-owned operation closely enough to distinguish a bounded test failure from an assertion failure elsewhere in the file.
- [ ] `v1/docs/operator-runbook.md` records the post-fix operator behavior: shrink `*.sandbox-unrunnable.test.ts` stalls fail boundedly, and follow-up guidance is to rerun or debug a red test rather than wait on a wedged job.
- [ ] `v2/docs/v1-behaviors.md` records that shrink sandbox-unrunnable stalls now fail the file boundedly instead of hanging the `Test` job.

## Documentation updates

- `v1/docs/operator-runbook.md` — update the shrink `*.sandbox-unrunnable.test.ts` gotcha/retry guidance to the bounded-failure behavior.
- `v2/docs/v1-behaviors.md` — record the new bounded-failure behavior for shrink sandbox-unrunnable stalls.
