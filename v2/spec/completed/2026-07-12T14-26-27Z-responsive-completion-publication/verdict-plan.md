- Add `v2/docs/write-behavior.md` as the durable owner of publication ordering, retries, failures, and asynchronous completion behavior; architecture may cross-link IPC responsiveness, and `v1-behaviors.md` must describe this as v2 parity/catalog behavior.

- Require async-seam coverage preserving retry count, backoff, retry notices, terminal propagation, and non-fast-forward no-retry behavior; async conversion must not alter publication policy.

- Clarify sequential command order within phases: auth → upstream detection → push → HEAD lookup → PR lookup/create → body refresh; this prevents races and satisfies the intent’s ordered publication constraint.

- Require PR-body attribution Git-read failure semantics to be explicitly preserved and tested through a rejected async seam, distinguishing intentional empty-footer fallback from refresh-failing errors.

- Make the responsiveness proof use the production daemon IPC transport (`startIpcServer` with connected Unix-socket clients), not a helper or whole-publisher stub.

- Require the test to hold an actual injected publication command after it becomes pending, prove `list` resolves before release, then finish publication; this proves event-loop yielding for an operator-relevant unrelated RPC rather than a timing race.


