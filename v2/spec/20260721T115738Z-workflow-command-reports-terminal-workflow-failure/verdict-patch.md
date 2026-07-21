1. Entry `list` must report `loopOutcomeKind: "complete"` for a genuinely completed multi-run workflow, with regression coverage. The checked success-path acceptance criterion is currently unmet.

2. Outcome projection must apply only when the stopping owner is the hidden `~shrink` row with `surviving_mutation_failed`. Later authored failures and other publication failures are explicitly deferred by the spec.

3. Preserve existing ordered rollup semantics when identifying the stopping row. A missing earlier durable step must still yield `killed`, rather than allowing a later non-completed row to take precedence.

4. Align the daemon wire type and daemon-host `list` schema with all returned entry-row fields: `loopOutcomeKind`, `iterationsConsumed`, and `resumable`. Tests must use the typed contract rather than masking drift with generic records.

5. Make surviving-mutation detail, including source file and line, observable through operator-facing `jarvis run list`, as directed by the runbook. The documented recovery path must provide enough information to identify and inspect the owning shrink row.

6. Narrow durable documentation to the implemented scope: hidden-shrink `surviving_mutation_failed`. Do not imply projection of deferred `completion_commit_failed`, `ready_gate_failed`, or arbitrary hidden-finalization outcomes.

7. Strengthen the daemon regression to prove the projected failure maps to a non-zero attached-command exit and preserves mutation source file and line in both entry `wait` and `list`. These are explicit workflow outcome and operator-detail contracts, not adequately covered by adjacent non-projection tests.
