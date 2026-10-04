- A timeout must stop the in-flight write execution before daemon cleanup releases its worktree claim. After `iteration_timeout`, no late execution may spawn or mutate the worktree; terminal fencing must cover side effects as well as logs and durable state.

- Workflow `list` snapshots must expose `iteration_timeout` as the stopped step’s terminal outcome, rather than degrading it to `invocation_failure`. This is required by the daemon snapshot/list/wait contract and documented vocabulary.

- Add short-budget daemon coverage for both direct and workflow launches proving timeout yields the failed terminal result, removes active-run liveness, releases worktree ownership, and is visible through `list`/`wait`. This is an explicit acceptance criterion and guards the cleanup contract.
