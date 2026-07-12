# The patch idle-output watchdog never sees claude's output

Jarvis has **never** recorded stdout from a claude patch run. Not intermittently —
zero times, across every claude patch record in `~/.jarvis/runs.jsonl`. The
idle-output watchdog is therefore structurally blind to claude: it can never fire,
never escalate to the next agent, and every claude patch run that doesn't finish
early rides the `iterationTimeoutMs` wall clock to exit 8.

## Problem

Observed 2026-07-12. Aggregating `mode: patch` records in `~/.jarvis/runs.jsonl` by
whether `last_output_age_ms` was ever non-null:

| agent | records with `last_output_age_ms: null` | with output |
| --- | ---: | ---: |
| **claude** | **33** | **0** |
| codex | 0 | 1 |
| cursor | 14 | 4 |
| opencode | 0 | 2 |

The triggering run — `2026-07-12T21-57-58Z-daemon-process-log-read`, patch primary
`claude-sonnet-5`:

```json
{
  "exit_reason": "watchdog-iteration-timeout",
  "duration_ms": 600339,
  "last_output_age_ms": null,          // never emitted ANY stdout in 10 minutes
  "last_file_activity_age_ms": 16752,  // but was writing files 16s before the kill
  "watchdog_descendants_alive": false
}
```

The agent was **alive and productive** the whole time — it wrote
`v2/src/daemon/daemon-process-log.ts`, its tests, and doc updates, right up to the
kill. Jarvis saw none of it. Only the file-activity probe noticed anything.

A `--agent codex` resume then completed the identical spec, 11/11 acceptance
criteria, in one iteration.

## Why this matters more than it looks

This silently invalidates the operator folklore built on top of it. Both of these
were misdiagnosed as model-quality problems and are almost certainly this bug:

- "claude-haiku stalls to a zero-output iteration-timeout, repeatedly, even
  serially" (operator-runbook, 2026-07-11) — attributed to Claude-pool contention
  with the operator's own session.
- "claude-sonnet-5 is too slow to be patch primary" (2026-07-12) — attributed to
  latency.

Neither explanation is needed. **Zero output is not a symptom of a slow or starved
agent; it is the absence of a measurement.** The contention theory in particular is
contradicted by the same session: two concurrent `claude-opus-4-8` *plan* runs
completed fine while the claude *patch* run "stalled," on the same pool, under the
same Claude operator session.

The consequences of the blindness compound:

- **No idle escalation.** `modes.patch.agentOrder` fallback on idle-output stall
  cannot trigger for claude — the ladder is dead for the default primary.
- **No early kill.** A genuinely wedged claude agent burns the full 10-minute wall
  every iteration instead of being escalated in seconds.
- **Wasted spend.** The failing run above: 294k tokens in, 1.8k out, zero iterations
  completed.
- **The pool-contention warning never fires.** The documented warning
  (`selected patch primary shares Claude pool with a live Jarvis operator/orchestration session`)
  did not appear on this run even though its conditions were exactly met — worth
  checking whether it is wired at all.

## Scope

- Find why claude's stdout is never observed on the patch path and fix the capture,
  so `last_output_age_ms` is populated for claude the way it is for codex/opencode.
  Compare against the codex binding, which reports output reliably.
- Whatever the cause (stream not piped, output on a different fd, buffered until
  exit, streamed-JSON not decoded into output events), the idle watchdog must see
  liveness for every configured agent.
- Add a guard so this cannot regress silently: if an agent completes a patch
  iteration having produced **no** observed output, that is a harness defect and
  should be surfaced, not treated as a normal idle timeout.
- Re-check `cursor` too — 14 null vs 4 with output suggests it is partially affected.

## Decisions

- Fix the observation, not the timeout. Raising `iterationTimeoutMs` would paper
  over a blind watchdog and make every real stall slower to catch.
- The pool-contention warning and the "prefer cursor / codex when the operator is a
  Claude session" guidance in the operator runbook are **provisional** until this
  lands — they may be mitigations for a bug that will no longer exist. Do not
  entrench them.

## Out of scope

- Changing the default `agentOrder`.
- The `iterationTimeoutMs` default (10 min).

## Documentation updates

- `v1/docs/operator-runbook.md` — correct the claude-haiku "zero-output stall"
  entry and the "prefer cursor when the operator is a Claude session" guidance once
  the real cause is fixed; both currently describe this bug as a model problem.
- `v1/docs/quota-signals.md` — how per-agent output is observed, and what a null
  output age means.
