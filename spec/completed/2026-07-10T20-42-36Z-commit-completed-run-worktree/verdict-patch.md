- Make completion-publication retry reachable: `jarvis run resume <run-id>` must retry a `completed` run carrying `completion_commit_failed`, while other completed runs remain idempotent.

- Preserve the owning completion contributor across durable-result rebuilds, workflow resume, already-completed steps, and intervening human/review steps. Retry and workflow publication must use that final successful write/shrink binding’s non-empty `metadata.agent`.

- Publish exactly one workflow completion commit after all required workflow work, including hidden shrink, regardless of whether the final workflow step is a write step. Use the owning completion write context for worktree/spec attribution.

- Reject missing or empty attribution before any Git mutation, including object creation.

- Make pending publication recovery crash-safe and idempotent: a commit object must not be rebuilt or duplicated if failure occurs between commit construction, pending-record persistence, ref update, or cleanup. Retries must return the original SHA and exclude later operator changes.

- Add focused tests covering snapshot content, ordering, clean no-op, attribution selection/validation, workflow and shrink ownership, all non-complete outcomes, Git failure recovery, daemon/foreground failure visibility, and retry idempotency. This is required by the completed spec’s explicit coverage criteria.

These outcomes are necessary to meet the specified durable completion boundary: SQLite remains `completed`, publication is recoverable and externally truthful, and the resulting commit is attributable, singular, and addressable.
