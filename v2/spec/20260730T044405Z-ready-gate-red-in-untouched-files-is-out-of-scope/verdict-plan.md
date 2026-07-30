1. Define terminal, complete failure attribution. Failing-file records must identify the final failing ready step/attempt so stale retry markers cannot turn a later non-test failure into an out-of-scope result. Specify duplicate semantics and cover concurrent, isolated load-sensitive, timeout, signal/null-status, and ordinary non-zero settlements.

2. Treat path-based classification as an ownership heuristic, not proof that the run caused or did not cause a failure. Remove claims such as “pure flake” or “run-caused” unless the boundary expands beyond the requested diff-plus-spec-tree policy.

3. Make touched-set derivation fail closed. Classification must remain `ready_gate_failed` when diff, untracked-file, rename/copy/delete, normalization, or other scope inputs cannot be resolved reliably. Tests must cover unusual filenames and path changes.

4. Validate attributed paths for correctness. Records must reject malformed, absolute, escaping, or accidentally colliding paths and have defined normalization and deduplication behavior. Security hardening against deliberate test forgery is not required, but accidental false attribution must be prevented.

5. Prove operator-visible evidence end to end. Durable settlement records and `list`/`wait` projections must retain the named outside paths, the `ready_gate_out_of_scope` reason, and finalization-retry guidance.

6. Expand resume coverage beyond admission. Both ordinary write runs and review/publication-tail reconstruction must retry finalization without an agent or repair invocation; a green retry must complete normal finalization, while repeated untouched-path red must settle out of scope again with preserved detail.

7. Cover repair-loop transitions. If an in-scope or mixed failure triggers one repair and the next gate is fully attributed only to untouched paths, the run must stop further repair and settle `ready_gate_out_of_scope`.

8. Clarify `requiredIntegrationScope`. Explicitly decide whether its failures are eligible for out-of-scope classification. Unless it has equally complete terminal attribution, preserve `ready_gate_failed`, backed by focused coverage.

9. Cover every durable and operator-facing outcome mirror affected by the new reason, including persistence/parsing, workflow settlement, recovery sets, CLI exit behavior, and list/wait projection. Add the relevant durable-contract documentation, including `v2/docs/daemon-host.md` and `v2/docs/workflow-runner.md`, alongside the already named docs.

10. Split oversized subspec 01 into independently implementable and testable subspecs across the classification, settlement/repair-bypass, durable operator handling, and resume/reconstruction seams. Every original task and acceptance outcome must appear exactly once across the replacements, and every replacement must be linked from `index.md`.
