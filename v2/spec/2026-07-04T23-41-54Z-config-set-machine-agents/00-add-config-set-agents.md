# Add `jarvis config set-agents`

Add a write command for the v2 machine agent-order file so the operator can
replace the persisted fallback order without hand-editing `~/.jarvis/v2.json`.

## Decisions

- `jarvis config set-agents <agent,agent,...>` writes the full `agents` list and rules out append/remove/reorder subcommands.
- CSV items are bare agent names and rule out v1-style `agent:model` entries because the machine file stores agent order only.
- Command-boundary parsing rejects CSV-specific invalid forms before config validation and rules out assuming the loader will catch empty segments or `agent:model` tokens after parsing to an array.
- Parsed agent arrays then reuse the existing machine-config loader contract and rule out a second post-parse validator with looser duplicate or emptiness rules.
- The write path preserves unrelated top-level keys in `~/.jarvis/v2.json` and rules out rewriting the file to `{ "agents": ... }` only.
- If `~/.jarvis/v2.json` exists but is not a valid machine-config object, `set-agents` fails and preserves the file, ruling out silently overwriting hand-edited broken state.
- Missing `~/.jarvis` parent state is created on write and rules out treating missing file or directory as a manual setup prerequisite.
- Success stdout reports the landed ordered agent list and rules out vague success output with no machine-readable order echo.
- Failure stderr states which input or file-state condition blocked the write and rules out a generic non-zero exit with no actionable cause.
- Invalid input exits non-zero before filesystem mutation and rules out partially writing the file or creating bootstrap state on rejected input.
- `set-agents` changes only the persisted machine default and rules out changing `--agents` override precedence at run start.
- A later run without `--agents` uses the newly persisted machine order and rules out treating `set-agents` as a write-only helper with no runtime effect.
- Durable operator semantics live in `v2/docs/agent-model-config.md`, while `v2/docs/v2-architecture.md` names the machine-agent show/edit surface including `jarvis config set-agents <agent,agent,...>`, ruling out command-surface ambiguity in architecture docs.

## Task checklist

- [ ] Add a CLI `config set-agents` path that accepts one CSV argument, rejects command-boundary parse failures, and writes `agents` into `~/.jarvis/v2.json`.
- [ ] Reuse the existing loader validation rules for non-empty, string-only, duplicate-free agent lists after parsing, while rejecting empty CSV segments and `agent:model` pairs at the command boundary.
- [ ] Preserve unrelated machine-config keys when updating `agents`, create the parent directory and file when absent, and refuse to overwrite an existing invalid machine-config file.
- [ ] Cover success and failure CLI behavior in tests, including stdout/stderr shape, persisted runtime effect, and no-write/no-bootstrap-on-invalid-input cases.

## Acceptance criteria

- [ ] `jarvis config set-agents claude,codex` writes `~/.jarvis/v2.json` with `agents: ["claude", "codex"]` in that order and preserves unrelated existing top-level keys.
- [ ] `jarvis config set-agents claude,codex` succeeds when `~/.jarvis` or `~/.jarvis/v2.json` does not yet exist, creating what it needs.
- [ ] `jarvis config set-agents claude,codex` prints the landed order on stdout in command order, and a later run without `--agents` uses `["claude", "codex"]` as the machine fallback order.
- [ ] `jarvis config set-agents` with an empty segment, a duplicate name, or an `agent:model` entry exits non-zero, prints a stderr error that identifies the rejected input, leaves prior file content unchanged, and does not create `~/.jarvis/` or `v2.json` when they were absent.
- [ ] `jarvis config set-agents claude,codex` against an existing `~/.jarvis/v2.json` that is not a valid machine-config object exits non-zero, prints a stderr error that makes the file-state problem clear, and preserves the broken file unchanged.
- [ ] `jarvis write` / `jarvis run start` `--agents` precedence over the persisted machine config remains unchanged after using `set-agents`.

## Documentation updates

- Update [`v2/docs/agent-model-config.md`](../../docs/agent-model-config.md) with the durable `jarvis config set-agents <agent,agent,...>` write semantics, command-boundary parse rules, invalid-file refusal behavior, success/failure output contract, and its relationship to `--agents`.
- Update [`v2/docs/v2-architecture.md`](../../docs/v2-architecture.md) so the focused show/edit note names the machine-agent show/edit surface, including `jarvis config set-agents <agent,agent,...>`, without restating the detailed workflow.
