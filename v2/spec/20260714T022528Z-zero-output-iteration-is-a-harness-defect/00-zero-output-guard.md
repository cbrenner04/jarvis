# 00 - Flag zero-output patch iterations

## Problem

A patch iteration in which the harness observed **no agent output at all** looks
identical, in `~/.jarvis/runs.jsonl` and on stderr, to an iteration whose agent went
idle after producing output: both land as `last_output_age_ms: null` or an ordinary
`watchdog-idle-timeout` / `iteration-timeout`. Nothing says "we measured nothing."
That ambiguity is what let the claude stdout blindness (#1450) survive 33 timeouts,
misread as model slowness and Claude-pool contention.

Zero observed output from a spawned agent is a harness measurement defect. Surface it.

## Decisions

- The guard is a visibility signal only: no change to exit codes, escalation ladder, or agent order. Rules out folding it into the quota/no-progress fallback ladder.
- Fires whenever the implementation-phase agent invocation ends with zero stdout **and** zero stderr bytes observed, regardless of outcome kind (`ok`, `error`, `quota`, timeout) — the timeout case is precisely the one that hid the bug, so excluding timeouts would defeat the guard.
- Fires only when the agent process actually spawned (a pgid was observed). Rules out firing on spawn failures (missing binary), which already carry their own named error and are not blindness.
- Agent-agnostic: keyed on observed bytes, not on `agent.name`. Rules out a claude-specific check, which would let the next binding regress silently.
- Telemetry: new `zero_agent_output?: true` field on `TelemetryRecord`, omitted (not `false`) when output was observed. Rules out overloading `last_output_age_ms: null`, which is watchdog-snapshot telemetry and cannot distinguish "never measured" from "not sampled".
- Named stderr constant lives in `v1/src/quota-harness-messages.ts` alongside the other grep-stable harness lines, and names the agent. Rules out an ad-hoc inline string with no grep contract.
- One warning per iteration, emitted after the invocation returns; not per-record (a single iteration can write two rows, e.g. `criteria-complete` + `completed-spec`).

## Task checklist

- [x] Add `HARNESS_ZERO_AGENT_OUTPUT` to `v1/src/quota-harness-messages.ts`.
- [x] Add `zero_agent_output?: true` to `TelemetryRecord` (`v1/src/telemetry.ts`) and to the patch iteration record type in `v1/src/modes/patch/iteration.ts` / `run.ts`.
- [x] In `v1/src/modes/patch/iteration.ts`, after the implementation-phase agent invocation returns, detect `lastOutputAtMs.current === null` with a spawned pgid; emit the named harness line on stderr and stamp `zero_agent_output: true` on every telemetry record that iteration writes.
- [x] Surface the condition in `v1/src/run-summary.ts` so the end-of-run summary distinguishes it from an ordinary idle/iteration timeout.
- [x] Tests in `v1/test/` covering: zero-output ok iteration, zero-output timeout iteration, an iteration with output (guard silent), and exit code unchanged in both zero-output cases.
- [x] Docs.

## Acceptance criteria

- [x] A patch implementation iteration whose agent produced no stdout and no stderr emits a distinct named harness line on stderr naming the agent (`HARNESS_ZERO_AGENT_OUTPUT`), instead of only the ordinary idle/iteration-timeout line.
- [x] Every `~/.jarvis/runs.jsonl` record written by that iteration carries `zero_agent_output: true`; records for an iteration that observed output omit the field entirely.
- [x] The guard fires for any configured agent binding (test drives it through a non-claude binding).
- [x] The guard does not change the iteration's exit code or the agent-escalation ladder: a zero-output idle timeout still exits 8 / escalates exactly as before.
- [x] The guard does not fire when the agent process never spawned.
- [x] The end-of-run summary reports the zero-output condition distinctly from an ordinary idle/iteration timeout.

## Documentation updates

- `v1/docs/quota-signals.md` — the zero-output condition: the grep-stable stderr line, `zero_agent_output` in the patch telemetry section, and what an operator does when it appears (it is a harness/binding blindness bug — the agent is likely alive and working; do not read it as agent idleness).
- `v2/docs/v1-behaviors.md` — record the new v1 behavior.
