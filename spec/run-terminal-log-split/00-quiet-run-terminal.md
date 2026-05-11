# 00 - Quiet run terminal, complete session log

## Problem

`jarvis run` currently prints agent stdout/stderr in the run terminal and also
writes those same streams to the session log and log server. The duplication is
no longer useful now that every run requires a reachable log server and opens a
session file.

The run terminal should answer "what is the harness doing and how did it stop?"
The session log should answer "what exactly happened?"

## Decisions

- Treat the session file under `~/.jarvis/sessions/` as the canonical full
  transcript.
- Keep writing every log-visible record to the session file, including:
  harness status, iteration banners, outbound prompts, inbound stdout, inbound
  stderr, quota messages, model-configuration failures, non-quota errors,
  no-progress stops, max-iteration stops, direct-spec confirmation outcomes,
  and completion messages.
- Keep forwarding the same full tagged records to the log server. The log server
  remains the live full-transcript viewer.
- Make `jarvis run` terminal output quiet:
  - Print harness lifecycle/status lines that help an operator understand
    progress: iteration banner, agent fallback, completion, no-progress stop,
    max-iteration stop, bad input, interrupted, and final failure reason.
  - Do not print successful agent stdout/stderr to the run terminal.
  - On agent failure, print the agent error output needed to diagnose the stop.
  - On no-progress or max-iteration stop, print a bounded tail of the most
    recent inbound stdout/stderr before the final harness stop line.
- The bounded tail is for terminal usability only. The session file and log
  server still receive the complete inbound streams.
- Use one documented tail size. Prefer a small line count (for example, last 40
  physical lines) over byte truncation so terminal output remains readable.
- Do not add a config knob in this spec. Revisit configurability only after the
  quiet default has been used in real runs.

## Behavior

### Successful agent iteration

For `result.kind === "ok"`:

- Write full `stdout` as `inbound_stdout` to the session file and log server.
- Write full `stderr` as `inbound_stderr` to the session file and log server.
- Do not write either stream to `opts.io.stdout` or `opts.io.stderr`.

The run terminal should still show the next iteration banner or final harness
status line, so it is clear the process is alive and advancing.

### Agent error

For `result.kind === "error"`:

- Write the failure reason and full agent diagnostics to the session file and
  log server.
- Print the same diagnostics to the run terminal stderr, preserving today's
  ability to see the actionable failure without opening the log file.
- Exit 3 as today.

### Model configuration failure

For `result.kind === "model_config"`:

- Write the harness explanation and full CLI diagnostics to the session file and
  log server.
- Print the same explanation and diagnostics to the run terminal stderr.
- Exit 3 without falling back, as today.

### No-progress and max-iteration stops

When stopping with exit 4 or 5:

- Write the full chronological transcript to the session file and log server.
- Print a bounded tail of the most recent inbound stdout/stderr to the run
  terminal before the final harness stop line.
- If there was no inbound output in the latest iteration, print only the harness
  stop line.

### Quota fallback

Quota diagnostics are log-visible and should be persisted fully. The run
terminal should print the concise fallback line (`<agent>: quota exhausted;
falling back`) and final `all agents quota-exhausted` line, but should not dump
the full provider quota transcript unless all agents are exhausted and that
transcript is the final reason.

## Tasks

- [x] Refactor `runCommand` logging fanout so "write to terminal" is independent
  from "write to session/log server".
- [x] Ensure every harness status/error path uses the logging path before
  returning, including model-configuration and generic agent-error paths.
- [x] Stop printing successful inbound stdout/stderr in `jarvis run`.
- [x] Track the latest iteration's inbound stdout/stderr so exit 4/5 can print a
  bounded terminal tail.
- [x] Add or update tests covering:
  - successful inbound output is absent from run terminal but present in session
    log and server payloads
  - agent errors print diagnostics in terminal and logs
  - model-configuration failures print diagnostics in terminal and logs
  - no-progress/max-iteration exits print only the bounded latest-output tail
    plus the stop line
  - full inbound streams are not truncated in session logs or server payloads

## Acceptance criteria

- `jarvis run` no longer double-displays successful agent output in the run
  terminal and log-server terminal.
- A session file is sufficient to reconstruct the complete run transcript.
- Failures remain diagnosable from the run terminal without opening the log file.
- Existing exit codes and completion/quota/model-config semantics are unchanged.
- `bun run typecheck` passes.
- `bun test` passes.

## Documentation updates

- [x] README: document the new split between `jarvis run` terminal output, session
  files, and `jarvis log-server`.
- [x] README: document the bounded tail behavior for no-progress and max-iteration
  stops.
