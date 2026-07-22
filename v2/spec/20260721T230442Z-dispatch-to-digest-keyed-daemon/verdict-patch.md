1. **Isolate durable run ownership by daemon digest.** Concurrent digest-keyed daemons must not share visible/controllable runs. `list` must return only the selected daemon’s rows; `wait`, `resume`, pause, kill, logs, and related run-ID operations must reject runs owned by another key. Shared persistence currently violates the spec’s single-daemon scope and can misreport liveness.

2. **Make concurrent auto-start reliable.** A caller losing the PID-lease race must wait boundedly for the winning daemon to become ready before dispatching. A single immediate reconnect is racy. Non-race startup failures must still propagate.

3. **Make PID leases recoverable and leak-free.** Startup failure, readiness failure, and daemon death must not permanently block later starts. Lease descriptors and caller-owned files require safe cleanup, while stale leases for dead processes must be reclaimable without disturbing live daemons.

4. **Remove retired TUI revision guarding.** TUI start/resume must use the selected digest-keyed daemon directly without a revision-status handshake or mismatch refusal. TUI defaults and tests must reflect keyed routing, including no legacy-socket interaction.

5. **Add the required routing regressions.** Tests must prove dispatch bypasses a live differently keyed daemon, legacy/different sockets receive no requests, socket/PID/log identities are keyed, and `list`/`wait` enforce daemon ownership. Pin delayed-winner readiness, both `EEXIST` and non-`EEXIST` lease outcomes, and cleanup/recovery paths in both directions.

6. **Align durable documentation.** Remove remaining fixed `daemon.sock`/PID/log defaults, bounce requirements, revision-mismatch recovery, and stale-PID recovery instructions. Document keyed durable ownership, concurrent-daemon isolation, auto-start readiness, and valid crash recovery in the durable homes required by the documentation standard.
