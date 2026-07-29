---
name: opencode-invocable-in-v2
---

# Make opencode invocable in v2 runs

v2's shared invocation registry (`shared/invocation/agents.ts`) wires only
`claude`, `codex`, and `cursor`; a resolved `opencode` binding falls through to
the "not wired yet" terminal error (exit 127), even though v2 config,
validation, and machine profiles (e.g. the `work` profile's `opencode`
role→model store) already accept opencode. A run using an opencode agent order
fails at invocation.

Wire opencode as a real agent: build the `opencode run --dir <cwd> --model
<model> --format json <prompt>` argv, spawn it through the existing shared
machinery, and parse its `--format json` stream so a successful iteration
reports token usage and cost (from `step_finish` `part.tokens` / `part.cost`)
rather than the unwired terminal error. PWD normalization is already generic in
shared and needs no per-agent change.

Observable behavior: an opencode rung in a resolved agent order actually spawns
the opencode CLI and produces a real invocation result (ok with usage/cost, or
a normal non-quota outcome) instead of exit 127 "not wired yet".

## Prerequisites
