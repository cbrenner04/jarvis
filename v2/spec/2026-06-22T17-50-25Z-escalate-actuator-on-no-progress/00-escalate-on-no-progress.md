# Advance agentOrder on no-progress before exiting 4

## Problem

A no-progress stop in patch mode (`iteration.ts` `result.kind === "ok"` path, currently `return { kind: "return", exitCode: 4 }`) exits immediately. The operator then bumps the model and re-runs by hand. The cheapest actuator no-progress-stalls routinely, so recovery is pure toil. Quota fallback already advances `activeAgents.shift()` and retries; no-progress should do the same, treating `agentOrder` as a cheap→strong escalation ladder.

## Decisions

- On no-progress, `activeAgents.shift()` then retry the iteration (`kind: "continue"`, `state.iteration += 1`), mirroring the quota-fallback branch. Rules out: keeping the immediate exit-4.
- Return exit 4 only when `activeAgents.length === 0` after the shift (last rung also no-progressed). Rules out: exiting on the first rung; exiting after a fixed retry count.
- Emit a no-progress-specific escalation stderr line on advance, distinct from the quota-fallback line. Rules out: reusing `HARNESS_QUOTA_FALLBACK_STRICT`, which would misreport the cause as quota.
- Telemetry for the advancing iteration uses a distinct `exitReason` (e.g. `no-progress-fallback`), separate from the terminal `no-progress` reason. Rules out: emitting the terminal `no-progress` reason on a non-terminal step, conflating advance with stop.
- Print the unticked-acceptance-criteria diagnostic only on the terminal exit 4 (ladder exhausted), not on each advance. Rules out: repeating the diagnostic per rung.
- Bound is the natural consequence of shifting a finite `activeAgents` (at most one pass through the order per spec); no extra iteration guard. Rules out: adding a separate escalation counter.

## Task checklist

- Replace the no-progress `return exit 4` with shift-and-retry; exit 4 only when `activeAgents` is empty.
- Add a no-progress escalation harness message constant; emit it on advance.
- Keep the unticked-criteria diagnostic on the terminal-exhausted path only.
- Update or add tests: multi-rung order escalates through agents on repeated no-progress and exits 4 only after the last rung; single-rung order still exits 4 on first no-progress.
- Documentation updates below.

## Acceptance criteria

- [ ] With a multi-entry `modes.patch.agentOrder`, a no-progress iteration advances to the next agent and retries instead of exiting; the next agent runs against the same subspec.
- [ ] Exit 4 (`no-progress`) is returned only after the final `agentOrder` entry also makes no progress.
- [ ] A single-entry `modes.patch.agentOrder` exits 4 on the first no-progress iteration (`run.test.ts` "exits 4 when a successful iteration makes no progress" stays green).
- [ ] The on-advance stderr line reports a no-progress escalation, distinct from the quota-fallback line.
- [ ] The unticked-acceptance-criteria diagnostic prints only on the terminal exit-4 stop, not on each advance.
- [ ] `v1/docs/agents.md` documents `agentOrder` advancing on no-progress, framing it as an escalation ladder ordered cheap→strong, and notes that advancing couples agent and model.
- [ ] `v1/docs/run-loop.md` exit-4 row and/or `v1/docs/quota-signals.md` state that no-progress escalates through `agentOrder` before exiting 4.
- [ ] `v2/docs/v1-behaviors.md` records that patch no-progress is no longer an immediate exit-4 (advances through `agentOrder` first), updating the relevant existing exit-4 entries.

## Documentation updates

- `v1/docs/agents.md` — `agentOrder` advances on no-progress as well as quota; document it as an escalation ladder (cheap→strong) and the agent+model coupling.
- `v1/docs/run-loop.md` and/or `v1/docs/quota-signals.md` — no-progress escalates through `agentOrder` before returning exit 4.
- `v2/docs/v1-behaviors.md` — update the exit-4/no-progress entries: no-progress now advances `agentOrder` (`activeAgents.shift()` + retry) and exits 4 only when the ladder is exhausted.
