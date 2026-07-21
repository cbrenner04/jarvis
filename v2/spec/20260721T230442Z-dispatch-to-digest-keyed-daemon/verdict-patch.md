1. **Use a platform-valid keyed socket path.** Production socket paths must fit Unix-domain-socket limits, including macOS defaults, while daemon identity remains derived from the full executable-tree digest.

2. **Isolate durable run ownership by daemon digest.** Differently keyed daemons must not admit conflicting project/branch work, reconcile or resume each other’s runs, or mutate shared run ownership. Concurrent keyed daemons must be safe.

3. **Scope all run operations to the selected daemon.** List, wait, resume, pause, kill, admission guards, and lifecycle stop guards must expose or consider only runs owned by that daemon. This is required by the selected-daemon acceptance criteria.

4. **Make same-key auto-start race-safe.** Concurrent dispatches must converge on one reachable daemon without unlinking another process’s socket, corrupting PID/log ownership, or stranding processes. Non-absence connection failures must remain actionable rather than being treated blindly as “daemon missing.”

5. **Fully retire revision dispatch refusal.** TUI start/resume and every other dispatch path must not retain executable-revision mismatch guards or bounce-era behavior.

6. **Strengthen the required regression coverage.** Tests must exercise actual work dispatch while a differently keyed daemon has live work, prove that daemon and the legacy socket receive no requests or lifecycle actions, and verify selected-daemon list/wait isolation.

7. **Align all durable documentation.** Remove contradictory fixed-socket, shared-daemon, and revision-guard descriptions from architecture, installation, TUI, and other durable homes required by `documentation-standard.md`.

8. **Resolve daemon identity only for daemon consumers.** Help, config, write, version, and unknown-command handling must not incur digest resolution or its Git-related failure modes when no daemon IPC or lifecycle operation occurs.
