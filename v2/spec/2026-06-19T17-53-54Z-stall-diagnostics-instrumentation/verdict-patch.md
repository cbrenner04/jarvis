## Verdict

### 1. Cover AC1 when spawn pid is unavailable at watchdog fire

**Outcome:** A test must prove that when the iteration watchdog fires before `onSpawned` sets a pid (`watchdogPgid` still `null`), the `watchdog-iteration-timeout` telemetry row includes `last_output_age_ms` and omits both `watchdog_descendants_alive` and `watchdog_pgid`.

**Rationale:** AC1 explicitly pins this subset. Implementation snapshots age outside the `pgid !== null` branch and gates descendant liveness on pgid availability, but no fixture exercises it. An unchecked acceptance path is not done.

### 2. Align operator docs with pgid-unavailable watchdog behavior

**Outcome:** Operator-facing docs must state that `watchdog-iteration-timeout` means the watchdog timer fired, not necessarily that a `[watchdog]` line was logged or a process group was killed. They must document the pgid-unavailable subset: telemetry still carries `last_output_age_ms`; `watchdog_pgid` and `watchdog_descendants_alive` are omitted; no watchdog log line is emitted. The fixed diagnostic suffix in `run-loop.md` applies only when that line is emitted.

**Rationale:** Documentation updates were part of the completed subspec. `quota-signals.md` still defines `watchdog-iteration-timeout` as always logging and killing; that is false for the pgid-null path the spec decided. `run-loop.md` documents suffix omission but not whole-line omission. Operators reading `runs.jsonl` without this context will misread telemetry-only timeout rows.

### 3. No behavioral changes required for core happy paths

**Outcome:** Snapshot-before-SIGTERM timing, frozen post-settle telemetry, `collectSubtree` liveness semantics, log suffix encoding when pgid is present, and the three existing stall fixtures match the spec. Exit code 8, kill sequencing, and quota fallback are unchanged. Do not alter watchdog policy or add tri-state liveness.

**Rationale:** Confirms scope for the actuator: fixes are test and doc alignment only, not reimplementation of the diagnostic instrumentation.

---

**Not required:** Session-log parity assertions on every new fixture, a lower bound on early-output age, negative `iteration-timeout` field-absence tests, `v1-behaviors.md` log-suffix mention, or `TelemetryRecord` comment formatting — reasonable hardening, not spec-bound gaps.
