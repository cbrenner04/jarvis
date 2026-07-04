# Add `jarvis config set-agents`

Add a write command for the v2 machine agent-order file so the operator can
replace the persisted fallback order without hand-editing `~/.jarvis/v2.json`.

## Decisions

- `jarvis config set-agents <agent,agent,...>` writes the full `agents` list and rules out append/remove/reorder subcommands.
- CSV items are bare agent names and rule out v1-style `agent:model` entries because the machine file stores agent order only.
- Write-time validation reuses the existing machine-config loader contract and rules out a second parser with looser rules.
- The write path preserves unrelated top-level keys in `~/.jarvis/v2.json` and rules out rewriting the file to `{ "agents": ... }` only.
- Missing `~/.jarvis` parent state is created on write and rules out treating missing file or directory as a manual setup prerequisite.
- Success prints the landed ordered agent list on stdout and rules out silent success that forces the operator to reopen the file.
- Invalid input exits non-zero with a stderr error and rules out partially writing the file before validation completes.
- `set-agents` changes only the persisted machine default and rules out changing `--agents` override precedence at run start.
- Durable operator semantics live in `v2/docs/agent-model-config.md` and rule out expanding `v2/docs/v2-architecture.md` beyond a focused cross-link.

## Task checklist

- [ ] Add a CLI `config set-agents` path that accepts one CSV argument, validates it, and writes `agents` into `~/.jarvis/v2.json`.
- [ ] Reuse the existing loader validation rules for non-empty, string-only, duplicate-free agent lists while rejecting `agent:model` pairs at the command boundary.
- [ ] Preserve unrelated machine-config keys when updating `agents`, and create the parent directory and file when absent.
- [ ] Cover success and failure CLI behavior in tests, including stdout/stderr and no-write-on-invalid-input cases.

## Acceptance criteria

- [ ] `jarvis config set-agents claude,codex` writes `~/.jarvis/v2.json` with `agents: ["claude", "codex"]` in that order and preserves unrelated existing top-level keys.
- [ ] `jarvis config set-agents claude,codex` succeeds when `~/.jarvis` or `~/.jarvis/v2.json` does not yet exist, creating what it needs.
- [ ] `jarvis config set-agents` with an empty segment, a duplicate name, or an `agent:model` entry exits non-zero, prints a clear stderr error, and leaves the prior file content unchanged.
- [ ] `jarvis write` / `jarvis run start` `--agents` precedence over the persisted machine config remains unchanged after using `set-agents`.

## Documentation updates

- Update [`v2/docs/agent-model-config.md`](../../docs/agent-model-config.md) with the durable `jarvis config set-agents <agent,agent,...>` write semantics, validation rules, success output, and its relationship to `--agents`.
- Update [`v2/docs/v2-architecture.md`](../../docs/v2-architecture.md) so the focused show/edit note cross-links the machine-agent config command surface without restating the detailed workflow.
