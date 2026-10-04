## Verdict — refine before landing

**1. Keystone checkpoint is inert as written.** The declared keystone mutates only the SIGTERM group signal to a direct-child kill; the group-mode SIGKILL escalation 50ms later would still reap the grandchild, so the pinning test stays green and completion refuses with `Inert headline change`. The spec must anchor the keystone on the single line that *selects* group semantics (mutated so group mode never engages), so the revert genuinely restores baseline behavior. The guard checkpoint should pin the same selector with the opposite forcing — one stable, uniquely-quotable anchor the implementation is obliged to expose, not a speculative local-variable line. Update the implementer notes accordingly: the notes may say "adjust the quoted text to match landed code," but they must not hand the implementer an anchor the implementation isn't required to write.

**2. Timeout behavior is decided but unverified.** The intent covers "abort **or** timeout," and the spec makes the riskiest decision here — an owned timer replacing `execFile`'s `timeout` in group mode — with no acceptance criterion exercising it. Add a timeout AC that fails against pre-fix code, and resolve two open sub-questions as Decisions:
- **Rejection contract.** Today a timeout rejects with `AsyncSubprocessError` carrying the string code from `execFile` (`ETIMEDOUT`). A group kill produces a different failure shape. Decide and state what a group-mode timeout rejects with; a silent divergence from the non-group path is an unrecorded contract change on a shared v1/v2 primitive.
- **Timer lifetime.** The existing escalation timer is `.unref?.()`'d specifically so it can't hold the loop open. State that the owned timeout timer is cleared on settle and unref'd; otherwise every group-mode call pins the event loop.

**3. Kill path must tolerate a missing pid.** The already-aborted branch invokes the kill path synchronously right after spawn, so a failed spawn reaches it with `child.pid` undefined. `process.kill(-undefined, …)` throws `TypeError`, which is outside the `ESRCH`/`EPERM` set the spec swallows. Extend the pid-undefined carve-out (already present for `onGroupId`) to the group-kill path.

**4. Pin the grandchild fixture shape as a Decision.** Both grandchild criteria are only meaningful if a genuine three-node process tree exists. The obvious `sh -c "<single command>"` form is exec-optimized into one process, so both tests would assert against a two-node tree and prove nothing — including the mutation/keystone evidence that rides on them. Specify a fixture that provably yields a distinct intermediate process and a separately-identifiable grandchild pid.

**5. Default-path test must not leak the orphan it creates.** The non-group criterion deliberately leaves a live grandchild and reaps it on the happy path. If an assertion throws first, the test leaks exactly the orphan class this spec exists to eliminate. Require unconditional cleanup (`try/finally`) in the criterion rather than an incidental parenthetical.

**6. Record the trades `detached` introduces.** Detaching inverts crash semantics: today a dying parent takes the child with it; a detached group survives parent death and, combined with `stdio: "ignore"`, is unreachable except via the recorded group id. That is strictly worse until the reaper consumer lands. State it as a recorded Decision trade (it is latent here — no caller opts in), not a design change.

**7. State the POSIX constraint.** Group signaling via a negative pid and `detached` semantics are platform-dependent; `shared/` is version-agnostic code consumed by both engines, so the supported-platform assumption belongs in Decisions rather than being inferred from the operator's machine.

**8. Note the pid-reuse hazard as a deferral.** Nothing in this subspec signals a stale group id, so no work is required here — but the future reaper that records and later signals a pgid needs liveness/ownership evidence before signaling. One deferral line; do not build ownership capture now, since the intent explicitly defers the consumer's shape.

**9. Trim the redundant clause in the first criterion.** Its distinct contract is group-id exposure; group termination is already the second criterion's job. Minor, but the duplication muddies which criterion the evidence attaches to.

### Not upheld

- **"Fails against the pre-fix code" for new-option tests.** A test that cannot compile against baseline satisfies the failing-test requirement; no change needed.
- **Documentation targets.** `v2/docs/v2-architecture.md § Steering semantics` is the only place the async runner's kill semantics are described; other mentions of `shared/subprocess.ts` concern the synchronous runner allowlist or invocation emission, neither of which this option touches. The single doc target plus the inline doc-comment is correct.