- Pin the durable documentation home for operator-facing CLI behavior in `v2/docs/` and scope `v2/docs/daemon-host.md` accordingly. The current draft assigns CLI semantics to a transport doc that explicitly says it owns wire shape only; the documentation standard requires one durable home for operator behavior, not an ambiguous split.

- Decide the production socket/PID path behavior this first CLI consumer ships, and make it part of the spec and durable docs. `v2/docs/daemon-host.md` currently defers `socketPath` defaults to the first CLI/TUI consumer; this slice is that consumer, so leaving path selection implicit violates the “first consumer pins it” rule.

- Clarify the operator-visible failure contract for lifecycle and run-control commands: unavailable daemon, already-running start, stop-when-stopped, unknown run, and guard failures. The spec needs observable outcomes such as exit status and where terse daemon errors surface, because “pass through tersely” is directionally correct but not reviewable enough for a thin transport contract.

- Pin the accepted `run start` CLI inputs and their mapping to `WriteLoopInput`. “Reuse existing parsing where practical” is not a contract; the spec needs stable invocation behavior for the new daemon path while preserving foreground `jarvis write` unchanged.

- Tighten `run log` to the daemon stream contract already established in durable docs: replay persisted records in order, then follow new records, and state the CLI framing/passthrough behavior for those records. This is necessary because the intent calls for a thin IPC client, and the current AC leaves both replay semantics and stdout format underspecified.

- Strengthen reviewability of run-control coverage. The spec should make verb behavior independently checkable where semantics differ and require test coverage for the pass-through error paths it claims not to reinterpret; otherwise the main risk in this slice, thin-client fidelity, is not pinned by acceptance criteria.
