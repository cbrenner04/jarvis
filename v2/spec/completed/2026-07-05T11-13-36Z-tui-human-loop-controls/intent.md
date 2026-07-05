---
name: tui-human-loop-controls
---
# Tui Human Loop Controls

# TUI human-loop controls

Extend the TUI run monitor with approve / revise / resume / kill controls for
a run sitting at `awaiting-human`: approve and revise send the human-loop
resume decision (revise prompts for optional free-text input), resume/kill
reuse the existing steering RPCs. Run rows also surface review-debate step
progress (current role in the debate cycle) the same way write-step progress
is shown today.

## Prerequisites

- human-loop workflow behavior exists with approve/revise/abort resume decisions and awaiting-human run status
- review-debate workflow behavior exists and reports per-role step progress
- TUI run monitor exists with pause/resume/kill steering controls and per-step progress display
