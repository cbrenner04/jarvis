1. Enforce one true wall-clock deadline across setup, start, status, stop, and cleanup. Once expired, no lifecycle command may launch with a zero/unbounded timeout. Injectable-time tests must cover both sides of every deadline guard.

2. Guarantee cleanup leaves no daemon process or IPC artifacts on every outcome. A failed forced stop must not be swallowed followed by deleting the state needed to identify an orphan; cleanup must confirm process termination, and tests must assert process death as well as directory removal.

3. Make the executable-tree mismatch regression deterministic. The test must explicitly establish that daemon-side drift completed after startup and before status, so failure proves CLI/daemon disagreement rather than relying on a 200 ms race. It must still distinguish the new handshake from the old `--help` probe.

4. Report the actual production CLI lifecycle interaction that failed. `smoke-failure.command` must identify the executed start, status, stop, or cleanup command—not the synthetic `daemon start/status/stop` surface marker—because the durable contract requires the executed command and failed observation.

These outcomes are required by the spec’s shared timeout, unconditional cleanup, real-boundary mismatch, accurate failure reporting, and bidirectional guard-coverage criteria.
