## Verdict — refinements required

The subspec is correctly sized (one implementation path, no split needed). Refine in place.

1. **Rebuild the rotation decision on a real rationale.** The current ledger justifies spawn-time-only rotation by asserting the chosen design can't do anything else — that's circular. The defensible argument is volume: `daemon.log` carries only process-level output (uncaught exceptions, spawn failures, stray harness stderr), because run output flows through the persisted log store and log-server stream path. At kilobyte-scale-per-lifetime, a spawn-time bound is sufficient. Rewrite the decision to state that, name the alternatives it rules out (in-daemon SIGHUP reopen, a writer/pipe process, child self-rotation on a size check), and keep the consequence explicit that one long-lived daemon can exceed the cap.

2. **Fix the directory-creation contradiction.** The spec cites `socketPath`/`pidPath` as precedent, but `startDaemon` today *throws* when the pid file's directory is missing. Align: a missing log directory throws rather than being created. Update the decision, task checklist, and the corresponding acceptance criterion.

3. **Pin ordering and fd lifetime.** Make explicit that the log is opened (and rotation checked) *before* `spawn()` — otherwise "an unwritable path fails the spawn" is false and leaves an orphan daemon — and that the parent closes its copy of the fd after handing it to the child. The lifecycle tests call `startDaemon` repeatedly in-process, so a leaked fd is a real regression surface.

4. **State stdin's fate.** One line: stdin stays ignored.

5. **Make the CLI acceptance criterion verifiable.** The CLI calls `startDaemon` through an injected deps struct; an AC phrased as "`jarvis daemon start` writes to `~/.jarvis/daemon.log`" can only be satisfied by touching the operator's real home directory. Restate it as the enforceable contract — deps carries a `logPath` defaulting to the pinned `DAEMON_LOG_PATH` and the CLI threads it into `startDaemon` — and add the deps plumbing to the task checklist.

6. **Restate the rotation AC to what is actually enforced.** Nothing prunes a stale `.1` when the current log is under cap, so "only the current file plus one rotated file remain" is not an invariant. State the real guarantee: when the existing log is at/over the cap, it replaces any prior `.1` and a fresh log is started.

7. **Add an append-across-restart criterion.** Append mode is a decision with no coverage. A restart under the cap must not clobber the prior daemon's output — that is exactly the post-mortem case the intent exists for.

8. **Drop the retained-file-count option; keep the byte-cap override.** The count knob has no caller — hardcode one retained file, per the deferral rule against inventing precision ahead of a consumer. The byte cap does have a first consumer (the rotation test, which otherwise has to write 5 MiB), so keep it configurable.

9. **Documentation must draw the boundary.** `v2/docs/daemon-host.md` should distinguish `daemon.log` (process-level stdio) from run/agent logs, since that distinction is what makes the spawn-time bound defensible, and note the shared-`logPath` caveat in one sentence (concurrent daemons pointed at one log path are unsupported; double-start protection covers the real case).

Rationale: items 1 and 9 are required because the intent's central deferral ("rotation is bounded") must rest on a stated reason a reviewer can check, not on a restatement of the design. Items 2, 3, 5, 6, and 7 are correctness/verifiability gaps — ACs that cannot be checked without touching operator state, or that assert invariants the implementation will not hold, fail the behavioral-AC contract. Items 4 and 8 keep the surface minimal and consumer-driven.