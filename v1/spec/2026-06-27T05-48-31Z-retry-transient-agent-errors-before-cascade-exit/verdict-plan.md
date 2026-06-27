## Verdict

Five refinements are required.

**1. Rule out `withSyncTransientRetry` explicitly**

The decisions ledger must add an entry ruling out `withSyncTransientRetry` as the reuse target. That helper is the git/gh synchronous retry driver (`v1/src/gh.ts`), unrelated to agent spawn retries. Without this entry, an implementer will audit that code path looking for a hook. The decision should name `isTransientSignal` + the existing `runAgent` loop as the correct reuse target and explicitly state why `withSyncTransientRetry` is not involved.

**2. Provide an actionable path to the stderr pattern**

The deferred regex entry says "confirm against an observed opencode failure before finalizing the pattern" with no pointer to where such a sample can be found. A deferred decision is acceptable; an unactionable one is not. The entry must reference a concrete source — existing test fixtures, a specific log location, a repro command, or a code pointer where opencode surfaces its error text — so the implementer can ground the regex against real output rather than guessing.

**3. Split AC2 into two independent criteria**

The current AC2 bundles the `isTransientSignal` scoping assertion (quota.ts) with the `isTransientNetworkError` non-regression assertion (gh.ts). These cover separate code paths and can be satisfied independently. They must be two separate ACs so a test cannot satisfy both with one fixture while leaving a gap in either.

**4. Add a non-regression AC for shared transport patterns under opencode**

Making `isTransientSignal` name-aware introduces a regression risk: if the name-aware dispatch fails to fall through to `sharedTransportPatterns` for opencode, an opencode 503/502 that currently retries silently stops retrying. There is no AC guarding this. The spec must add an AC (and a corresponding test case) asserting that existing shared transport patterns (e.g., 503) still classify transient for an opencode invocation after the name-aware change.

**5. Rule out call-site changes in the decisions ledger**

`config.name` is already passed as the first argument at both `runAgent` call sites in `spawn.ts`. Making `isTransientSignal` name-aware therefore requires no caller changes. A competent implementer will audit call sites expecting to find something missing. The decisions ledger must include an entry ruling out call-site updates and stating why (parameter already threaded through).