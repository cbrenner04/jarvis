# Advance agentOrder on no-progress before exiting 4

## Problem

A no-progress stop in patch mode (`iteration.ts` `result.kind === "ok"` path, currently `return { kind: "return", exitCode: 4 }`) exits immediately. The operator then bumps the model and re-runs by hand. The cheapest actuator no-progress-stalls routinely, so recovery is pure toil. Quota fallback already advances `activeAgents.shift()` and retries; no-progress should do the same, treating `agentOrder` as a cheap→strong escalation ladder.

## Decisions

- On no-progress, `activeAgents.shift()` then retry the iteration (`kind: "continue"`, `state.iteration += 1`), mirroring the quota-fallback branch. Rules out: keeping the immediate exit-4.
- Return exit 4 only when `activeAgents` is empty after the shift (last rung also no-progressed) — subject to `maxIterations`, which can pre-empt ladder exhaustion since each advance does `state.iteration += 1; continue` and rungs count toward the cap (same as quota fallback). Rules out: exiting on the first rung; exiting after a fixed retry count; claiming the cap is bypassed.
- Emit a no-progress-specific escalation stderr line on advance, distinct from the quota-fallback line. Rules out: reusing `HARNESS_QUOTA_FALLBACK_STRICT`, which would misreport the cause as quota.
- On advance, suppress/reword the terminal "made no progress; stopping" line and the bounded-tail line so only the exhausted (terminal exit-4) path reports stopping. Rules out: emitting "stopping" wording on a step that continues, which misleads the operator.
- Telemetry for the advancing iteration uses a distinct `exitReason` (e.g. `no-progress-fallback`), emitted on a non-terminal `kind: "ok"` row (matching the existing terminal `no-progress` and `criteria-progress` advance rows), not a quota-flavored kind. Rules out: emitting the terminal `no-progress` reason on a non-terminal step; using a quota row kind.
- Print the unticked-acceptance-criteria diagnostic only on the terminal exit 4 (ladder exhausted), not on each advance. Rules out: repeating the diagnostic per rung.
- The advance is run-wide: `activeAgents` is never restored, so the actuator stays escalated for subsequent subspecs in the run (matches existing quota-fallback semantics). Rules out: per-spec restoration logic, which contradicts reusing the mechanism.
- Quota fallback and no-progress shift the same `activeAgents`; interleaved signals (quota on one rung, no-progress on the next) consume the same finite ladder. Rules out: a separate per-signal ladder.
- Bound is the natural consequence of shifting a finite `activeAgents`; no extra iteration guard. Rules out: adding a separate escalation counter.
- Out of scope: ready-gate fix-up no-progress does not escalate — that block is fix-up-guarded and stays as-is.

## Task checklist

- Replace the no-progress `return exit 4` with shift-and-retry; exit 4 only when `activeAgents` is empty.
- Add a no-progress escalation harness message constant; emit it on advance.
- On advance, suppress/reword the "stopping" and bounded-tail lines; keep them on the terminal-exhausted path only.
- Keep the unticked-criteria diagnostic on the terminal-exhausted path only.
- Modify the existing `run.test.ts` no-progress tests (default 3-entry `agentOrder`) to pin `agentOrder` to a single `claude` entry, preserving the single-rung exit-4 case; their current assertions would otherwise break under the new shift-and-retry behavior.
- Add a new multi-rung test: escalates through agents on repeated no-progress, retried iteration targets the same subspec, and exits 4 only after the last rung.
- Documentation updates below.

## Acceptance criteria

- [ ] A new multi-rung test shows that with a multi-entry `modes.patch.agentOrder`, a no-progress iteration advances to the next agent and retries instead of exiting, and the retried iteration runs against the same subspec.
- [ ] Exit 4 (`no-progress`) is returned only after the final `agentOrder` entry also makes no progress, unless `maxIterations` is reached first.
- [ ] A single-rung `modes.patch.agentOrder` exits 4 on the first no-progress iteration; the existing `run.test.ts` no-progress tests are modified to pin a single `claude` entry to preserve this case.
- [ ] The on-advance stderr line reports a no-progress escalation (mentions no-progress/escalation), not merely differing from the quota-fallback line.
- [ ] The advancing iteration emits a distinct `exitReason` (e.g. `no-progress-fallback`) on a non-terminal `kind: "ok"` telemetry row, not a quota-flavored kind or the terminal `no-progress` reason.
- [ ] The terminal "stopping" / bounded-tail / unticked-acceptance-criteria output prints only on the terminal exit-4 stop, not on each advance.
- [ ] `v1/docs/agents.md` documents `agentOrder` advancing on no-progress, framing it as an escalation ladder ordered cheap→strong, and notes that advancing couples agent and model.
- [ ] `v1/docs/run-loop.md` exit-4 row and/or `v1/docs/quota-signals.md` state that no-progress escalates through `agentOrder` before exiting 4.
- [ ] `v2/docs/v1-behaviors.md` records that patch no-progress is no longer an immediate exit-4 (advances through `agentOrder` first), updating the relevant existing exit-4 entries.

## Documentation updates

- `v1/docs/agents.md` — `agentOrder` advances on no-progress as well as quota; document it as an escalation ladder (cheap→strong) and the agent+model coupling.
- `v1/docs/run-loop.md` and/or `v1/docs/quota-signals.md` — no-progress escalates through `agentOrder` before returning exit 4.
- `v2/docs/v1-behaviors.md` — update the exit-4/no-progress entries: no-progress now advances `agentOrder` (`activeAgents.shift()` + retry) and exits 4 only when the ladder is exhausted.
