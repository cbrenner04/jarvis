# Jarvis v1 — Spec Index

This is the entry point for building jarvis v1. Read this file first. Each unchecked entry below points at an atomic subspec. Complete the subspec, then **check its box**. The unchecked boxes are how the agent (and the loop) know what to work on next.

When every box is checked, v1 is done.

## Subspecs

- [x] [01 — Project setup](./01-project-setup.md)
- [x] [02 — Config bootstrap](./02-config.md)
- [x] [03 — CLI entrypoint](./03-cli.md)
- [x] [04 — `jarvis init` (target-repo scaffolding)](./04-init-command.md)
- [x] [05 — `jarvis config` command](./05-config-command.md)
- [x] [06 — Prompt builder](./06-prompt.md)
- [x] [07 — Agent adapter interface + `claude`](./07-agent-claude.md)
- [x] [08 — `codex` adapter](./08-agent-codex.md)
- [x] [09 — `cursor` adapter](./09-agent-cursor.md)
- [x] [10 — Quota detection (research + implementation)](./10-quota-detection.md)
- [x] [11 — Completion detection](./11-completion-detection.md)
- [x] [12 — Loop orchestration](./12-loop.md)
- [x] [13 — Installation docs](./13-install-docs.md)
- [x] [14 — Code quality tooling](./14-code-quality.md)

## Conventions

- One subspec per iteration. Do not bundle.
- Each subspec has its own acceptance criteria and documentation updates.
- If a subspec is blocked, append a `## Blocker` section to that file and stop.
