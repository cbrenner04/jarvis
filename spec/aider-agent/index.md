# Aider agent

repo: cbrenner04/jarvis

Add [`aider`](https://aider.chat) as a supported agent CLI in jarvis. Aider's
draw is its first-class support for **local LLMs** (Ollama, llama.cpp, LM
Studio, and other OpenAI-compatible local endpoints). Wiring aider into the
existing agent abstraction unblocks users who want to drive jarvis runs
entirely off local models, without depending on a hosted Claude / Codex /
Cursor / opencode account.

## Problem

Jarvis currently supports `claude`, `codex`, `cursor`, and `opencode`. All
four are oriented around hosted model providers. Users who want to use a
local model (e.g. an Ollama-hosted Llama or Qwen variant on their own
workstation) have no way to drive jarvis runs through that model today.

Aider has a non-interactive mode (`aider --message <prompt>`) shaped enough
like the existing agents to be driven the same way the other agent modules
are. Adding it gives local-LLM users a path into the harness without
changing the loop, completion semantics, or worktree behavior.

## Approach

Mirror the existing agent modules — especially `src/agents/opencode.ts`,
since opencode is the most recent "third-party CLI shaped like the others"
addition. Add a fifth module `src/agents/aider.ts` that spawns `aider` in
non-interactive mode with the prompt passed via `--message`. Expand
`AgentName` (declared in both `src/agents/types.ts` and the `AGENT_NAMES`
tuple in `src/config.ts`) to include `"aider"`, then add an `"aider"`
case to the agent factories in `src/modes/patch/run.ts`,
`src/modes/plan/draft.ts`, and `src/modes/plan/review.ts`. Aider is
selectable but **not** in the default `modes.{patch,plan}.agentOrder` —
users opt in by adding `{ "agent": "aider", "model": "..." }` to one of
those arrays in `~/.jarvis/config.json`.

The first subspec verifies the aider CLI flag surface (non-interactive
invocation, model selection, auto-commit suppression, permission posture)
before any code lands, so the rest of the spec is not built on guesses about
flag names.

## Subspecs

- [x] [00 — Verify aider CLI flags](./00-verify-aider-cli.md)
- [x] [01 — Aider agent module](./01-aider-agent-module.md)
- [x] [02 — Config and AgentName expansion](./02-config-and-agentname.md)
- [ ] [03 — Aider quota and model-config signals](./03-aider-signals.md)
- [ ] [04 — Documentation](./04-documentation.md)

## Conventions

- Complete one subspec per iteration. Do not bundle.
- If a subspec is blocked, append a `## Blocker` section to that file and
  stop.

## Non-goals

- Adding default `agentOrder` entries for aider. The user opts in.
- Bundling or recommending a specific local LLM runtime (Ollama,
  llama.cpp, LM Studio). Aider already abstracts these; jarvis should not
  re-document them.
- Pricing / cost tracking for local models. Local inference has no
  per-token cost, so the agent reports `cost_source: "no-usage"` like
  opencode does today.
- Changing the harness loop, completion semantics, or worktree behavior.
- Touching `claude.ts`, `codex.ts`, `cursor.ts`, or `opencode.ts` beyond
  what is needed to expand the `AgentName` union.
