# 04 — Documentation

## Problem

The new aider agent, the configuration changes, and the quota-signal list
all need to be discoverable in the project docs. Without this, future
users will not know aider is a supported agent or how to point it at a
local LLM.

## Decisions

- README is the primary touchpoint. Update existing sections rather than
  creating new top-level documents.
- Keep the README "Agents" table the source of truth for invocation flags.
- Document one canonical local-LLM setup (Ollama) as the worked example,
  since it is the most common local backend aider supports. Other backends
  (llama.cpp, LM Studio, hosted OpenAI-compatible APIs) get a one-line
  pointer at aider's own docs, not a step-by-step.
- `AGENTS.md` and `docs/spec-guidance.md` do not need updates.

## Tasks

- [ ] Add an `aider` row to the Agents table in `README.md` with:
      - CLI invoked: the finalized argv from subspec 00.
      - Notes column: `--model` is required; prompt is passed via
        `--message`; aider runs with `--yes-always` and
        `--no-auto-commits` so jarvis remains the only committer.
- [ ] Add a new "Aider setup" subsection under the Agents heading that
      explains:
      - Aider is opt-in (not in default `agentOrder`).
      - The primary use case is local LLMs; users supply their own runtime
        (Ollama is the worked example).
      - Worked example: install Ollama, `ollama pull llama3.1:8b`, set
        `patchModels.aider` to `ollama/llama3.1:8b`, add `aider` to
        `agentOrder`, and run `jarvis run` as usual.
      - One-line pointer that aider also supports hosted providers and
        other local runtimes — see `https://aider.chat/docs/llms.html`.
      - No per-token cost is reported for local runs (matches the
        `cost_source: "no-usage"` returned by the agent module).
- [ ] If `README.md` has an "Agent CLI verbosity" (or similarly named)
      subsection, add an `Aider` bullet naming `--no-stream` and the
      rationale (matches the buffered transcript shape of the other
      agents). If no such subsection exists, skip this task and note the
      skip in the PR description rather than inventing a new section.
- [ ] Update the `Config` schema example in `README.md` to show `aider`
      in `patchModels` (with the placeholder string) and a note that
      adding it to `agentOrder` is opt-in.
- [ ] Cross-link the `## Aider` section in `docs/quota-signals.md` added
      by subspec 03 from the new README subsection.

## Acceptance criteria

- [ ] README clearly states aider is supported, that its primary use case
      is local LLMs, and how to enable it with a worked Ollama example.
- [ ] The Agents table includes an `aider` row consistent with the
      existing rows.
- [ ] No vendor-specific recommendation beyond "Ollama is the worked
      example"; other backends get a pointer, not a walkthrough.
- [ ] `bun run check` passes (Biome formatting on Markdown if applicable).

## Documentation updates

- `README.md` — Agents table, aider-setup subsection, Agent CLI verbosity
  bullet, Config schema example.
