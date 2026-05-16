# 05 - Local model docs

After scoped patch mode and aider support land, Jarvis needs concise user
documentation for local model usage. The docs should explain when to choose
aider vs opencode, how to configure an Ollama-backed model, and why scoped
files matter.

## Decisions

- Keep this doc practical, not a benchmark claim. Jarvis should not assert
  one tool is universally better.
- Position aider as the recommended first try for local one-shot patch mode
  when the spec has good `## Patch scope`.
- Position opencode as the existing general agent option when users prefer
  its provider/tooling flow or have a model that handles tool calls well.
- Document that local Ollama context settings matter and may need tuning
  outside Jarvis.
- Include a minimal config snippet for patch mode with aider and an Ollama
  model.

## Patch scope

### Editable

- README.md
- docs/agents.md
- docs/config.md
- docs/run-loop.md
- docs/spec-guidance.md

### Read-only context

- spec/2026-05-16-local-patch-scope-and-aider/index.md
- src/config.ts
- src/agents/aider.ts
- src/agents/opencode.ts

### Out of scope

- Do not add benchmark tables.
- Do not document unsupported plan-mode aider behavior.

## Task checklist

- Add a short local-model section to the relevant docs.
- Include an aider config example using an Ollama-style model string.
- Explain that `## Patch scope` improves reliability and is required for
  aider patch runs.
- Explain recovery when the outside-scope guard blocks a run.
- Cross-link existing opencode setup docs rather than duplicating all
  opencode provider setup.

## Acceptance criteria

- [ ] Docs explain when to try aider versus opencode for local patch runs.
- [ ] Docs show a patch-mode config example for aider with an Ollama model
      string.
- [ ] Docs explain that aider requires `## Patch scope` with at least one
      editable file.
- [ ] Docs mention local context-window configuration as an Ollama-side
      prerequisite, not something Jarvis controls directly.
- [ ] README links to the local-model guidance.
- [ ] Documentation avoids benchmark or quality claims that are not tested in
      this repo.

## Verification

- Run `bun run typecheck`.
- Run `bun test`.

## Documentation updates

- This subspec is documentation-only.
