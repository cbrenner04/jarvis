1. **P1 — Enforce cross-daemon worktree ownership.** Concurrent digest-keyed daemons must atomically prevent duplicate live ownership of the same `(project, branch)` across start, resume, workflow admission, and queue promotion. Daemon-local registries are insufficient because all daemons share worktrees and durable state.

2. **P1 — Make PID leases recoverable and failure-safe.** A lease must distinguish a live owner from stale residue, recover stale leases safely, and be released after every failed startup path without deleting a replacement owner’s lease. Otherwise crashes, spawn failures, or readiness failures can permanently block the keyed daemon.

3. **P1 — Handle concurrent startup readiness.** A CLI losing the keyed-daemon start race must wait within a bounded readiness window for the winning daemon before dispatching. A single immediate reconnect can fail during the normal lease-before-socket interval. Winner failure and timeout must remain actionable.

4. **P1 — Isolate selected-daemon observation.** `run list` and `run wait` must expose only runs owned by the invoking executable’s selected daemon, with correct liveness. Reading the shared store without daemon ownership attribution violates the completed single-daemon scope criteria and can report another daemon’s live run as non-live.

5. **P2 — Correct durable documentation.** Required docs must consistently describe keyed PID/log/socket paths, `run start` output as a run ID, selected-daemon list/wait semantics, automatic matching-daemon startup, and removal of revision guards/bounce behavior. Remove remaining legacy `~/.jarvis/daemon.log`, daemon-metadata output, and dispatch-status-guard claims.
