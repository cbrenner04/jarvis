---
name: inline-prompt-oneshot
---

# Intent: one-shot inline prompt command

Add a `jarvis1` command that takes prompt text inline, sends it to the agent
exactly once through the existing agent machinery, and prints the response.
No spec, no worktree, no loop — a single round trip.

## Why

- Every existing entrypoint (patch, plan, review) wraps the agent in a spec
  lifecycle. There is no way to just ask the configured agent one thing and
  see its answer through the same fallback/quota path the rest of Jarvis uses.
- Useful for quick checks: prompt iteration, sanity-testing agent config, and
  confirming an agent is reachable without standing up a run.

## Rough shape

- New subcommand (e.g. `jarvis1 ask "<text>"` or `jarvis1 once`) that reads
  prompt text from the argument and/or stdin.
- Builds an `AgentRunOptions`, runs one agent via the existing fallback order
  (`claude → codex → cursor`, per config), and writes the agent's response to
  stdout.
- Reuses `createAgent` / `runAgent` and the existing quota classification — no
  new agent code path.
- No worktree, no commits, no PR, no telemetry run row required (decide whether
  to emit an invocation row anyway for cost visibility).

## Open questions to resolve while drafting

- Command name and arg shape: positional text, `-` for stdin, or both.
- Which model/agent-order config it reads — a dedicated key or reuse of an
  existing mode's order.
- Whether a quota-exhausted fallback chain exits with the standard quota exit
  code or a simpler error.
- Whether to emit a telemetry/invocation row, or keep it side-effect-free.
- Output: raw agent text only, or any framing/usage summary.

## Acceptance criteria (rough)

- `jarvis1 <name> "<text>"` sends the text to one agent and prints the response
  to stdout.
- Agent selection uses the configured fallback order; quota on one agent falls
  through to the next.
- Runs without a spec, worktree, commit, or PR.
- Errors (all agents unavailable / quota) exit non-zero with a clear message.
- Docs updated:
  - `v1/docs/` — short reference for the command, its config, and exit codes.
  - `README.md` — one-line mention in the command overview.

## Out of scope

- Multi-turn / conversational sessions.
- Any spec, worktree, or PR lifecycle.
- Streaming output if it complicates the single-round-trip contract.
