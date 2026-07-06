## Verdict

Refine `00-queue-promotion-direct-invocation.md`:

1. **API mapping when adopting the shared fake executor.** State explicitly that the shared `createFakeWriteLoopExecutor` exposes `settleFirst()` where the local copy exposed `settleOne()` (same behavior, rename at the call site), and that the local copy's `pendingKeys()` has no callers in this file and is dropped, not preserved. Without this, an implementer must independently diff the two executor APIs to discover the rename and confirm nothing behavioral is lost.

2. **Full scope of socket call sites to convert.** The Decisions section currently narrates conversion only through the `startHandlers` wrapper. Note that at least one test constructs `startIpcServer` inline, independent of that wrapper, and must convert too. The acceptance criteria (no `startIpcServer`/`connectIpcClient`/etc. anywhere in the file) already force this, but the Decisions prose should say so explicitly so an implementer doesn't stop after converting only the wrapper path.

Refine `01-revise-direct-invocation.md`:

3. **Pin the location of the direct-resume helper.** The current phrase "matching the `resumeDirect`-style... helper already used in `daemon-start-list.test.ts`" is ambiguous — that helper is a private, file-local function there, not a shared export. Decide and state explicitly whether `daemon-revise.test.ts` gets its own local `resumeDirect`-equivalent helper, or whether one is added to `v2/src/testing/run-control.ts`. Since this subspec only needs `resume` (not pause/kill) and the intent scopes shared helpers to `startRunDirect`/`listRunsDirect`/`mockWriteLoopInput`, a local, file-scoped helper is the lower-churn default absent a reason to share it — but the spec must say so rather than leave it to the implementer to guess.

No other refinements required. The timing/ordering conversion pattern is already validated precedent (same conversion shipped for `daemon-start-list.test.ts`) and needs no new acceptance criterion. Recording literal pre-conversion test counts in each subspec is optional polish, not required — the acceptance criteria's diff-based "same number of tests as before conversion" is already self-contained and verifiable without it.