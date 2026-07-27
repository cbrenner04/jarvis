1. Preserve real `invocation_failure` outcomes when no binding starts or `invocation.final` is null. Clean trees must report `no_file_changes` without requiring agent attribution. Define truthful handling for dirty attribution-less work without fabricating an agent or creating unattributed commits.

2. Apply the same rule to pre-binding abort and watchdog losses. After quiescence, clean runs must retain their intended abort/timeout settlement; dirty runs need a documented durability and attribution policy.

3. Restore deterministic settlement ordering. Once an invocation wins as settled, its checkpoint and SQLite boundary—especially `progress`—must be recorded before a later abort exits the loop. An already-persisted kill remains authoritative.

4. Fail closed on git inspection errors. `no_file_changes` is valid only when an unchanged tree is proven; inability to read `HEAD` must produce resumable `iteration_commit_failed`, not false skip telemetry.

5. Checkpoint quiesced `executeWrite` rejections before their `invocation_failure` boundary when they may have mutated the worktree. This is required by the settled-result durability floor and current “every settled result” documentation.

6. Remove the post-settlement durability window around coverage advisory execution. Primary invocation edits must become durable before another agent invocation, while the advisory still receives the intended changed-lines input and any advisory mutations are covered before the boundary.

7. Add focused regression coverage for real no-binding/model-config results, pre-binding abort and watchdog paths, post-settlement abort ordering, git inspection failure, rejecting `executeWrite`, and coverage-advisory ordering. At least one newly eligible terminal/failure checkpoint must verify subject, `Spec:`, and `Jarvis-Agent:` metadata.

8. Align durable docs with the final behavior: enumerate covered settled outcomes, describe attribution-less and rejected-execution handling, and describe `iteration_commit` as applying to all eligible checkpoints rather than only `progress`.
