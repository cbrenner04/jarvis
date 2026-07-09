**Verdict: Refinement required.**

Four gaps name concrete pre-existing behavior the draft's decisions don't cover, plus one scoping gap. All five must be addressed:

1. **Cleanup on normal resolution is unspecified.** The draft's `Set` of `AbortController`s only describes the `close()` teardown path. Nothing states when an entry is removed on the common case — a wait resolving or erroring normally. Add a decision that each per-request entry is removed from the `Set` when its `follow()` call settles (resolve, abort, or error), plus an acceptance criterion verifying the `Set` doesn't accumulate stale entries across normal completions. Without this the rewrite introduces a resource leak the current fanout doesn't have.

2. **The immediate-resolve short-circuit path is not accounted for.** Current behavior evidently includes a case where `wait` can resolve immediately from `tail()` without entering the follow loop (e.g., already-terminal run status). The decision "each `wait` request calls `logReader.follow()` directly" reads as if it covers every case, but a full rewrite risks silently dropping this short-circuit. Add an explicit decision that this path is preserved unchanged, and ensure the task checklist/tests cover it.

3. **Error propagation from `follow()` needs an explicit decision, not an assumption.** There's no existing per-call reject pattern to lift (comparable stream handling doesn't reject at all), so the new per-waiter handler's error behavior must be stated explicitly: a thrown error from one waiter's own `follow()` call rejects only that waiter's promise, independent of other concurrent waiters on the same run.

4. **Status re-fetch at resolution time is real current behavior that must be named.** The existing fanout re-reads run status from the store at resolution rather than reusing the subscribe-time snapshot. The draft doesn't mention this. Add a decision stating the per-waiter handler re-fetches current run status when resolving, so an implementer doesn't accidentally reuse stale subscribe-time state.

5. **Test-sizing task is too vague to act on.** "Size down `daemon-wait-run-completion.test.ts`... keep it green" doesn't tell the implementer which cases are fanout-internal (safe to cut) versus behavior-level (must stay, e.g., two-concurrent-waits, disconnect-one-waiter). Name the split explicitly in the task checklist.

Non-issues (no refinement needed): concurrent independent `follow()` calls being safe is fine as an implicit assumption, not a gap; the doc line-number anchor is already appropriately hedged with `~`.

**Rationale:** These are all instances of the same risk — a "rewrite the handler" task silently dropping pre-existing, currently-tested behavior (immediate resolve, per-waiter error isolation, status re-fetch, cleanup on the non-close path) because the draft's decisions describe only the happy-path replacement, not the full behavioral surface being preserved. Per spec guidance, decisions must be load-bearing and explicit precisely where a competent implementer could plausibly choose differently — each of these four is such a case.