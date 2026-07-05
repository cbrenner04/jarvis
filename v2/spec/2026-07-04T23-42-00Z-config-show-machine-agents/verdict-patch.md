## Verdict

### Required outcomes

1. **Fix misleading mutation wording in `v2/docs/agent-model-config.md`.** The paragraph after the `set-agents` / `show` / `path` sentence currently says “That command replaces the full `agents` array…”, which reads as applying to all three subcommands. Operator docs must attribute filesystem mutation (`agents` replacement, key preservation, bootstrap, refuse-invalid-overwrite) **only** to `jarvis config set-agents`. `show` and `path` remain read-only inspection per the subspec and the Read-only inspection section.

2. **Close AC #6 for `jarvis run start`.** Acceptance criterion #6 requires both `jarvis write` and `jarvis run start` to keep precedence `CLI --agents` > machine config `agents` > `DEFAULT_WRITE_AGENTS`. `write` already has a no-`--agents` machine-config fallback test; `run start` only exercises `--agents` override. Add coverage proving `run start` without `--agents` forwards machine-config `agents` into the IPC `start` payload (same shared `parseWriteCliInput` path). Rationale: AC text names both commands; structural sharing is insufficient proof for a named acceptance criterion.

### Not required

- Invalid `agents` (including `[]`, `null`, bad entries) surfacing as config-read errors rather than the no-override line — spec-intentional; loader + CLI tests already cover it.
- Pinning exact stderr strings, filesystem I/O errors, `formatConnectionError` rename, stale `intent.md`, v1 README drift, extra-arg usage, or production `homedir()` integration — out of subspec scope or explicitly deferred.
- Optional doc polish (e.g. one-line “present but invalid `agents` is an error”) — nice-to-have, not blocking.
