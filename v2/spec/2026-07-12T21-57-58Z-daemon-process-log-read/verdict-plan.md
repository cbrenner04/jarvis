- Define `--follow` behavior across truncation, replacement, and removal: it must continue from the configured log path rather than silently tailing a stale inode.

- Require a lossless replay-to-follow transition: bytes appended during handoff must not be missed or duplicated.

- Specify read, watch, and reopen failures as stderr errors with nonzero exit; partial or silently hanging diagnostics are unacceptable.

- Define the CLI’s SIGINT exit behavior.

- Pin the command contract: usage includes `log`; only `jarvis daemon log [--follow]` is accepted; other flags/orders fail with daemon usage and exit `1`.

- Preserve dependency-injected log paths for tests and alternate environments; the production path is the default, not a hard-coded-only behavior.

- State that log reading does not require daemon PID, socket, or IPC status checks; file accessibility alone determines success. This preserves the intended on-disk diagnostic path.

- Add the daemon-log CLI contract to `v2/docs/write-behavior.md`, alongside the already-required daemon-host, recovery-workflow, and parity documentation. Durable operator-facing semantics must be documented in their canonical homes.
