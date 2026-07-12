---
name: claude-streams-output-to-watchdog
---

# Claude streams output so the idle watchdog can see it

## Problem

Jarvis has never recorded stdout from a claude patch run — 33/33 `mode: patch`
claude records in `~/.jarvis/runs.jsonl` have `last_output_age_ms: null`. The
cause is `v1/src/agents/claude.ts`: it spawns claude with `--output-format json`,
a batch envelope written once at exit. `spawn.ts`'s `stdout.on("data")` activity
bump therefore never fires mid-iteration, so the idle-output watchdog is
structurally blind to claude: it can never fire, never escalate via
`modes.patch.agentOrder`, and a live-but-slow claude run rides `iterationTimeoutMs`
to exit 8. The triggering run (`2026-07-12T21-57-58Z-daemon-process-log-read`)
was writing files 16s before the 10-minute kill.

Codex and opencode stream and report output reliably; opencode already consumes
an NDJSON event stream.

## Decisions

- Fix the observation, not the timeout — raising `iterationTimeoutMs` papers over a
  blind watchdog and slows every real stall.
- Switch claude to a streaming output format and decode it incrementally, so each
  event bumps the activity clock. Ruling out: keeping batch JSON and synthesizing
  liveness from the file-activity probe, which observes only writes, not thinking.
- The terminal result event remains the source of the final text, exit
  classification, token counts, and quota signals — no regression in
  `parseClaudeJsonOutput`'s outputs.

## Out of scope

- Changing the default `agentOrder`.
- The `iterationTimeoutMs` default (10 min).
- Cursor's output format.

## Acceptance criteria (behavioral)

- A claude patch iteration populates `last_output_age_ms` in `~/.jarvis/runs.jsonl`
  the way codex and opencode do.
- An idle claude patch iteration trips the idle-output watchdog and escalates to the
  next configured agent, instead of running out the iteration wall clock.
- Existing claude parse behavior (final text, quota classification, token/cost
  accounting) is unchanged.

## Documentation updates

- `v1/docs/quota-signals.md` — how per-agent output is observed and what a null
  `last_output_age_ms` now means.
- `v2/docs/v1-behaviors.md` — records the changed claude invocation/observation
  behavior.

## Prerequisites
