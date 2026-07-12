- Clarify dirty-gate scope: it applies to `resume` with `decision: "revise"`, not ordinary paused-run `resume`. Preserve `revise_requires_input` and all other admission outcomes.

- Require linearizable revise admission while the async dirty probe is pending: concurrent same-run requests cannot create duplicate revisions or leave status/ownership inconsistent; probe failure must leave retryable pre-admission state. Async dispatch removes the current incidental serialization.

- Make responsiveness regressions exercise real IPC/server dispatch: a safe unrelated RPC must respond before the held Git operation releases, for both worktree setup and dirty admission.

- Define the async runner’s observable compatibility contract: UTF-8 stdout and existing rejection/predicate behavior must remain intact, including Git-probe failures mapped to `false` where callers currently do so. Cover async worktree failure cleanup, including lock release.

- Enumerate the daemon-hosted external-worktree entry points being migrated and exclude non-daemon consumers. This prevents an incomplete migration while preserving v1’s synchronous seam.

- Keep one normative documentation home per behavior: daemon architecture/host docs own responsiveness semantics; `v1-behaviors.md` records parity only.
