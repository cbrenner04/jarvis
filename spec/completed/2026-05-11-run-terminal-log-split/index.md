# Run terminal / log split

`jarvis run` currently tees most agent-visible output to both the interactive
run terminal and the session log/log server. Now that logging is mandatory, the
run terminal should be operator-focused and quiet, while the session log is the
canonical transcript.

## Goal

- The session log file contains everything needed to reconstruct the run.
- The log server may continue to display the full tagged stream for live
  monitoring across sessions.
- The `jarvis run` terminal shows concise harness status and only prints agent
  output when it helps explain why the run stopped.

## Subspecs

- [x] [00 - Quiet run terminal, complete session log](./00-quiet-run-terminal.md)

## Conventions

- Run this spec with `jarvis run spec/2026-05-11-run-terminal-log-split/index.md`.
- Complete one subspec per iteration. Do not bundle.
- If the subspec is blocked, append a `## Blocker` section to that file and
  stop.
