1. Correct the baseline description: failure discovery is pipeline-wide, while later shape analysis may already narrow to a failed non-default branch. Identify sibling failures—not awaiting siblings alone—as the current blocker.

2. Define and test branch-scoped malformed-shape refusal: multiple failures in the target branch, invalid target predecessors, and non-skipped target suffixes must refuse with complete non-mutation.

3. Require deterministic evidence for genuine racing or stale-analysis interference and atomic rollback. Sequential duplicate calls alone do not prove the intent’s racing and no-partial-mutation guarantees.

4. Align mutation checkpoints with executable changes: every added or modified branch-selection, no-fallback, and conditional-write guard must have a linked directive and a negative case proving suppressed writes cannot leave partial state.

5. Replace the ambiguous “earliest durable row as the split” contract with explicit continuation-boundary semantics. Define how incomplete or missing durable rows affect validity so implementations cannot disagree about the shared prefix or target continuation.

6. Define `branchKey: "default"` explicitly: reject it, treat it as scoped, or alias omission. This is necessary to preserve the promised unscoped compatibility contract without leaving a materially different API interpretation open.

7. Match preservation evidence to the intent’s byte-for-byte guarantee. Tests must compare the relevant raw persisted sibling data before and after, including lifecycle payload columns; otherwise weaken the contract to value equality explicitly.

The work remains one atomic state-store subspec; no split is required.
