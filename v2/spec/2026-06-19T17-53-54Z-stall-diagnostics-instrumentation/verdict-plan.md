## Verdict

The spec’s problem, scope, field names, and single-subspec shape are sound. Load-bearing gaps are **when** diagnostics are captured, **what** tests pin, and **how** the operator-facing contract is encoded. Refine the draft; no scope expansion or subspec split.

## Required refinements

1. **Pin capture to watchdog fire, not post-settle.** The contract must require snapshotting `last_output_age_ms` and `watchdog_descendants_alive` inside the iteration watchdog callback when `watchdogFired` becomes true — before group kill and before `agent.run` settles. Telemetry and the post-`agent.run` timeout branch consume those frozen values. *Rationale:* Post-settle reads inflate output age and can false-negative descendant liveness after SIGKILL; intent is “diagnosable at kill time.”

2. **Order sampling before the first group kill.** Descendant liveness must be sampled immediately before the first `SIGTERM` to the agent process group in that callback. *Rationale:* Sampling after grace/SIGKILL breaks the hang fixture and contradicts “live descendants at watchdog fire.”

3. **Name the descendant model explicitly.** “Descendants” must mean `collectSubtree` from the agent root pid (`onSpawned` / `watchdogPgid`), using reap’s transitive `ppid` + shared-`pgid` semantics — not naive pgid-only membership. *Rationale:* Matches existing `DescendantTracker` infrastructure; avoids implementer inventing a divergent sampler.

4. **Pin log-line encoding.** The existing `[watchdog] iteration timeout fired after Nms; killing agent pgid <pgid>` line must gain a fixed suffix with the same snake_case keys and values as telemetry (e.g. `last_output_age_ms=<n|null> watchdog_descendants_alive=<true|false>`). *Rationale:* AC2 requires parity across session log, stderr, and `runs.jsonl`; unpinned format invites drift.

5. **Specify `watchdogPgid === null` behavior.** When watchdog fires but pgid is unavailable: still emit `last_output_age_ms`; treat `watchdog_descendants_alive` like optional `watchdog_pgid` (omit or document a single default). *Rationale:* Mirrors current optional `watchdog_pgid` handling; avoids silently dropping half the diagnostic.

6. **Pin the mutable ref contract.** Decisions/tasks must state caller-owned per-iteration ref shape, init (`null`), update site (stdout/stderr `data` in spawn), and that telemetry reads the snapshot not a live recompute. Documentation updates must include the `AgentRunOptions` inline doc-comment per `documentation-standard.md`. *Rationale:* Structure is the harness contract; export docs are required, not optional.

7. **Cover both stall shapes in acceptance criteria and tests.** Require at least two cases: (a) hang-agent — no pipe output → `last_output_age_ms: null`, live descendant → `watchdog_descendants_alive: true`; (b) early stdout/stderr then stall → age well below `iterationTimeoutMs` with an explicit margin tied to fixture timing. Add AC for agent-only stall → `watchdog_descendants_alive: false`. *Rationale:* One fixture cannot satisfy AC3 and AC4 together; negative liveness is the common case and currently untested.

8. **Make AC3 testable.** Replace the unbounded “not the full `iterationTimeoutMs`” assertion with fixture-bound timing and a concrete upper bound on recorded age. *Rationale:* Behavioral ACs must be verifiable without re-running production timeouts.

9. **Complete documentation homes.** Beyond `run-loop.md` and `v2/docs/v1-behaviors.md`, add `quota-signals.md` mention of the new watchdog-timeout fields (parallel to `watchdog_pgid`) and the `AgentRunOptions` inline doc. *Rationale:* Placement policy and operator discovery; spec already changes existing telemetry behavior cataloged in `v1-behaviors.md`.

10. **Optional one-liner: best-effort liveness.** If recorded: failed/empty `listProcesses()` yields `watchdog_descendants_alive: false` (no tri-state). *Rationale:* Matches reap best-effort elsewhere; keeps the boolean contract simple.

## Not required

- Subspec split (atomic once timing, tests, and format are pinned).
- Prerequisites section (watchdog/reap are verification targets, not merge gates).
- New abort policy, idle-output watchdog, or prompt/plan instrumentation.
- `unknown`/tri-state descendant liveness enum.
