---
name: verifier-group-sigkill-escalation-dies-with-its-parent
---

# The non-terminating-mutant bound returns on time but never kills the runaway process

## Problem

`#3578` bounded diff-derived mutant execution: a killing test is spawned with `timeoutMs: MAX_KILLING_TEST_MS` and `processGroup: {}`, and on expiry the verifier settles `non-terminating-mutation` instead of hanging. That part works — the verifier returns on time.

**The runaway process survives.** Observed 2026-09-08, live on this machine:

```text
PID    PPID  PGID   ELAPSED  %CPU   COMMAND
31086  1     31086  10:34    100.0  bun test v2/src/daemon/daemon-run-control-handler-guard.test.ts
```

`PPID 1` (reparented to `launchd`), `PGID == PID` (it is its own group leader, so the detached group was created correctly), and its `cwd` is `…/T/mutation-verifier-while-true-guard-zKqdXB` — the temp fixture directory created by `diff-derived-mutation-verifier.test.ts:1225`, already deleted by that test's `finally`.

So the process that outlived everything was spawned by **the regression test that proves non-terminating mutants are bounded**. The test asserted elapsed time and result kind, both of which passed, while the child it started kept burning a core indefinitely.

This is the mechanism behind the brief's "one core at 100% for 2h55m": the hang was never the verifier waiting, it is the killing test never dying. Fixing the wait (shipped) did not fix the leak.

## Mechanism

`runGroupMode`'s `killGroup` (`shared/subprocess.ts:107-126`) signals `process.kill(-pgid, "SIGTERM")`, then schedules the SIGKILL escalation as:

```ts
setTimeout(() => { process.kill(-pgid, "SIGKILL"); }, 50).unref?.();
```

`unref()` means that timer does not hold the event loop open. On the timeout path the promise rejects **immediately** after SIGTERM, so the owning process is free to finish and exit within the 50 ms grace — and when it does, the SIGKILL escalation never fires. A child spinning in a tight `while (true)` loop is precisely the case that does not die on SIGTERM promptly, so the one escalation that would have killed it is the one guaranteed not to run.

The inline comment asserts the opposite ("the SIGKILL escalation below must still fire on its own schedule"), which is true only while the parent happens to outlive the grace.

Confidence: the observation (orphan, own group leader, fixture `cwd`, survived >10 minutes at 100% CPU) is direct. The `unref()`/parent-exit reading is inferred from source and fits the evidence; a competing reading is that `bun test` ignores SIGTERM entirely, which the same fix covers.

## Decisions

- Group termination is not considered complete until the group is observed gone: escalate SIGTERM → SIGKILL and confirm with `process.kill(-pgid, 0)`, on a timer that keeps the process alive for the duration of the grace; rules out an `unref()`'d escalation that a parent exit silently cancels.
- The termination path is awaited before the call settles, so a caller cannot return while the group is still alive; rules out settling the promise on the timeout path and leaving reaping to a best-effort timer.
- Verification that a bound *terminated the process*, not merely that the call returned, belongs in the regression test for every bounded spawn; rules out asserting elapsed time and result kind alone, which is exactly what let this ship green.
- Applies to every `processGroup` spawn (mutation verifier, base-ref probe, runtime smoke, ready gate), not only the mutation path; rules out a point fix at the verifier call site.
- Existing abort-path behavior is preserved, pinned; rules out changing live-kill semantics while fixing the timeout path.

## Acceptance criteria

- [ ] A test spawns a child that ignores `SIGTERM` and spins, drives the `timeoutMs` path, and proves the process group is gone after the call settles (`process.kill(-pgid, 0)` throws `ESRCH`); it fails against the current `unref()`'d escalation.
- [ ] A test proves the call does not resolve or reject until group termination has been confirmed.
- [ ] A test proves an owning process that exits immediately after the timeout still leaves no surviving group member.
- [ ] `diff-derived-mutation-verifier.test.ts`'s while-true guard regression additionally asserts that the spawned killing-test process is gone when `verifyDiffDerivedMutations` returns; it fails against the current elapsed-time-and-kind-only assertions.
- [ ] Existing abort-path group-kill coverage stays green.
- [ ] `bun run typecheck`, `bun run test:v2`, `bun run test:integration:v2`, and `bun run test:shared` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — a bounded verifier spawn guarantees the process group is dead when the call settles, not merely that the call returned.
- `v2/docs/operator-runbook.md` — the leaked-`bun test` gotcha: the mutation bound shipped, but its own regression test leaked an orphan; keep attributing by CPU and parentage.
- `v2/docs/v1-behaviors.md` — record the strengthened termination contract.
