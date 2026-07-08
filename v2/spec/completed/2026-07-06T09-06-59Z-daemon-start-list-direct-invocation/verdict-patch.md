Verdict: 1 required fix.

**Missing test for cross-instance isolation (acceptance criterion 00-3 not actually demonstrated).**

Subspec 00's acceptance criteria explicitly require proof that "two `createRunControlHandlers` instances track review-debate progress independently (no shared state leaks between instances)" — this is the core motivation for the subspec (removing the module-global `Map`). The existing test at `daemon-start-list.test.ts` covers isolation between two `invocationId`s within a *single* `createRunControlHandlers()` instance, not isolation across two separate instances. No test constructs two handler instances and asserts that progress reported via one instance's `reportReviewDebateProgress` does not appear in the other instance's `list` output.

**Required outcome:** Add a test that creates two separate `createRunControlHandlers` instances, reports review-debate progress on one, and asserts the other instance's `list`/snapshot output does not reflect it. This must actually exercise the scoping behavior the subspec claims to deliver, not just re-verify same-instance isolation.