1. Split the oversized subspec into independently testable pipeline-observation and TUI-aggregation subspecs. Link both from `index.md`, and assign every existing task and acceptance outcome exactly once across them.

2. Preserve the intent’s canonical rule that any reachable undecided gate counts as `awaiting gate`, including when a fan-out sibling is running. Add baseline-failing coverage for that state; checking only `awaiting-approval` is insufficient because pipeline state can remain `running`.

3. Correct ad-hoc liveness classification: a group is `running` when it has active members or its existing rollup remains non-terminal, including terminal-looking durable rows with hidden live activity. Only fully terminal rollups may become `done` or `failed`; ad-hoc work must never count as `awaiting gate`.

4. Explicitly state and test that queued work remains queue-only and is excluded from the four dock counts. This resolves the current overbroad “any non-terminal member” wording without expanding the intended work-tree scope.

5. Add dock-level coverage proving a pipeline’s matched workflow invocation is not also counted as ad-hoc, while a genuine ad-hoc invocation is counted. The tree join’s existing behavior alone does not verify correct aggregation.

6. Add coverage for standalone ad-hoc rows as degenerate one-item groups, not only collapsed multi-run invocations.

7. Give each executable subspec appropriate baseline-failing and guard-mutation criteria under the spec guidance, while retaining the required typecheck, scoped v2 tests, integration tests, documentation outcomes, and unchanged left-pane guarantees exactly once.
