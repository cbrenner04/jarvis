1. Add genuinely connected re-dispatch coverage for implement and plan, with and without `--reset-despite-dirty`. Submitted workflow steps must reach locked materialization and the write callback through workflow execution; a fake `start` handler invoking the materializer directly does not satisfy the acceptance contract.

2. Prove registered and inconclusively classified paths fail re-dispatch and retain their residue. Materialization errors must reach the CLI as failure, not be swallowed behind exit `0`.

3. Classify the husk only when Git’s `not a git repository` diagnostic appears in captured failure diagnostics, including explicit subprocess `stderr`. All other status failures must retain the existing fail-closed refusal under both override states.

4. Strengthen no-mutation evidence to cover every retirement action: worktree removal/pruning, local and remote ref deletion, tracking-ref pruning, and PR closure. This is required by the guard-inversion criterion.

5. Correct the operator runbook so it does not imply plan supports or recreates from `--base`. Distinguish implement’s explicit base from plan’s resolved repository base while preserving the documented husk behavior.
