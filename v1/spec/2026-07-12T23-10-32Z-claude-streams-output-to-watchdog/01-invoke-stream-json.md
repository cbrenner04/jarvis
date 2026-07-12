# 01 - Invoke claude with stream-json

## Problem

`v1/src/agents/claude.ts` spawns `claude -p … --output-format json`, a single envelope
written at exit. `spawn.ts`'s `stdout.on("data")` activity bump therefore fires once, at
the end, so `lastOutputAtMs` never advances mid-iteration: 33/33 `mode: patch` claude
records in `~/.jarvis/runs.jsonl` carry `last_output_age_ms: null`. The idle-output
watchdog is structurally blind to claude — it cannot fire, cannot escalate via
`modes.patch.agentOrder`, and a stalled claude rides `iterationTimeoutMs` to exit 8.

With 00 landed, the parser reads the terminal result event, so the invocation can flip.

## Decisions

- Spawn with `--output-format stream-json --verbose` (the claude CLI rejects stream-json
  in print mode without `--verbose`). Events arrive per-line during the iteration, so each
  one bumps the activity clock in `spawn.ts` — no change to `spawn.ts` itself. (Rules out:
  keeping batch JSON and synthesizing liveness from the file-activity probe, which observes
  only writes, never thinking.)
- Displayed iteration output stays the parsed `result` text, not the raw transcript — the
  `--verbose` transcript is a liveness signal, not operator-facing log.

## Task checklist

- [ ] Swap `--output-format json` for `--output-format stream-json --verbose` in
      `claude.ts`'s `buildArgv`.
- [ ] Update argv assertions in `v1/test/claude-agent.test.ts`; cover a streamed transcript
      end-to-end (final text, usage, cost, quota classification).
- [ ] Cover that a claude run emitting events over time advances `lastOutputAtMs`.
- [ ] Docs.

## Acceptance criteria

- [ ] A claude iteration that emits stream events over time advances the spawn layer's
      last-output clock more than once, so a completed claude patch iteration records a
      non-null `last_output_age_ms` in `~/.jarvis/runs.jsonl` the way codex and opencode do.
- [ ] A claude patch iteration that emits no output for `idleOutputTimeoutMs` trips the
      idle-output watchdog and escalates to the next configured agent, instead of running out
      the `iterationTimeoutMs` wall clock.
- [ ] Existing claude behavior is preserved: `v1/test/claude-agent.test.ts`,
      `v1/test/claude-json.test.ts`, and `v1/test/run-cost-claude.test.ts` stay green
      (final text, quota classification, token/cost accounting unchanged).

## Documentation updates

- `v1/docs/agents.md` — claude's invocation row and the output-format rationale (currently
  states claude "avoids `--verbose`").
- `v1/docs/quota-signals.md` — claude runs with `--output-format stream-json`; what a null
  `last_output_age_ms` now means (a genuinely silent agent, not an unobservable one).
- `v2/docs/v1-behaviors.md` — records the changed claude invocation and that claude is now
  observable by the idle watchdog.
