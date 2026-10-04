---
name: human-loop-behavior
---
# Human Loop Behavior

# Human-loop workflow behavior

Add `human` as a supported workflow step behavior. Reaching a `human` step
pauses the run to `awaiting-human`, same convergence point as a `blocked`
output-contract outcome — no blocker files, no polling. Resume takes an
explicit decision: `approve` (advance to next step), `revise` (repeat the
step's configured range, consuming one of its `N`; requires a dirty worktree
or an injected free-text prompt, reject otherwise), or `abort` (kill the
run). Runner and daemon steering carry the decision through the same
pause/resume/kill primitives Phase 3 already exposes.

## Prerequisites

- workflow runner dispatches steps by `behavior`, with only `write` supported today
- daemon exposes pause (graceful, boundary-checked) and kill (immediate abort) steering over the run's `AbortSignal`/`pauseSignal`
- run status model already includes `paused` and `killed` statuses
- output-contract `blocked` outcome exists and currently has no resume path
