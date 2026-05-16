# 05 — `jarvis config` command

Provide a minimal CLI surface for reading and editing `~/.jarvis/config.json`.

## Subsubcommands

- `jarvis config show` — prints the current config as pretty JSON.
- `jarvis config path` — prints the absolute path of `config.json`.
- `jarvis config set-order <agent,agent,agent>` — replaces `agentOrder`. Validates against the allowed agent set; rejects duplicates and unknown agents.
- `jarvis config projects` — lists registered projects (name → root).
- `jarvis config remove-project <name>` — removes a project entry; errors if name is unknown.
- `jarvis config edit` — opens `config.json` in `$EDITOR` (fallback `vi`); on exit, re-validates and rejects (with a non-zero exit and a message) if invalid.

## Tasks

- [ ] Implement in `src/commands/config.ts`.
- [ ] All writes go through `writeConfig()` from spec 02 — no ad-hoc file writes.
- [ ] Tests: `set-order` happy path + invalid input; `show` returns the loaded config.

## Acceptance criteria

- `jarvis config show` after `jarvis config set-order codex,claude,cursor` reflects the new order.
- Invalid order arg → exit 1, no file change.

## Documentation updates

- Add a "Configuration" subsection under "Usage" in `README.md` listing each `config` subsubcommand.
