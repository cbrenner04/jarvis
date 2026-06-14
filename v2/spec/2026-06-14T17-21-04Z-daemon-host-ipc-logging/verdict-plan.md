Required refinements:

- Clarify pause vs abort semantics in `03`: pause must have a clean boundary disposition distinct from killed/crashed interruption, and the spec must state why existing abort behavior is insufficient for graceful pause.

- Define daemon stop behavior once active runs exist: stopping the daemon must specify what happens to active, paused, failed, and terminal runs, and how clients observe the result.

- Clarify daemon-owned `(project, branch)` ownership lifetime: specify exactly when ownership is held and released across active, paused, failed, blocked, budget-soft-stopped, killed, and done states.

- Separate daemon health from run status: define the operator-facing difference between `jarvis daemon status` and `jarvis status`, including expected scope/output.

- Pin structured-log storage enough for implementation: specify whether logs use a separate SQLite file or share the existing state database, and how migrations/bootstrap are handled.

- Clarify `log.tail` before detached runs land: state whether unknown/arbitrary run IDs are allowed, and how replay/follow behavior is tested independently of run lifecycle.

- Add minimum streaming robustness requirements: live tail must clean up disconnected subscribers and avoid one slow subscriber blocking appends.

- Require evidence that streaming and request/response frames coexist on one socket once `log.tail` lands.

- Pin CLI autostart operator semantics: executable discovery, readiness timeout, stdio handling, and failure reporting must be specified before run-control commands depend on autostart.

- Scope process-group kill precisely: distinguish injectable abort behavior from real child-process process-group termination, and avoid expanding invocation architecture beyond what kill requires.

- Require `bun run ready` for each materially invasive subspec, not only the final steering slice, because daemon lifecycle, IPC, persistence, and CLI surfaces all affect operator-facing behavior.

- Add durable documentation requirements for invocation kill/abort contracts if the binding seam changes, including `shared-invocation.md` or its actual durable home.

- Clarify v1 behavior impact: where docs say “no change,” explicitly state these are additive v2-only surfaces and do not restate or alter v1 kill/resume/lock behavior.

- Require `v2-architecture.md` alignment with the as-built second-host model, since Phase 3 intentionally diverges from older daemon-first wording and durable docs must match shipped architecture.
