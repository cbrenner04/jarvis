# v2 agents config moves to ~/.jarvis/config.json, retire v2.json

`agents` (the ordered agent fallback chain) currently lives in
`~/.jarvis/v2.json`, read/written via `v2/src/config/machine-config-loader.ts`
and `jarvis config show|path|set-agents` in `v2/src/cli.ts`. Move this to a
top-level `agents` key in `~/.jarvis/config.json` (the same file v1's
`projects` registry lives in) and stop reading/writing `~/.jarvis/v2.json`
anywhere.

## Prerequisites

- [[00-v1-config-preserves-unknown-keys]] lands first — otherwise a v1 config write clobbers `agents` immediately after `set-agents` writes it.

## Decisions

- `machine-config-loader.ts`'s default path (and `cli.ts`'s `DEFAULT_MACHINE_CONFIG_PATH`) becomes `~/.jarvis/config.json`, not `~/.jarvis/v2.json` — no dual-read fallback, no migration of an existing `v2.json`, per the intent's "retire ~/.jarvis/v2.json entirely."
- `set-agents` merges into the existing `config.json` document (already the loader's behavior via `{...existing, agents}`), so v1 keys (`projects`, `modes`, etc.) round-trip unchanged.
- v2 does not import v1's `CONFIG_PATH`/`Config` type from `v1/src/config.ts` — it defines its own path constant to the same file, keeping `v2/**` decoupled from `v1/**` internals.
- An existing `~/.jarvis/v2.json` is not migrated — it's left inert on disk after cutover; the operator must re-run `set-agents` post-upgrade to repopulate `agents` in `config.json`.

## Task Checklist

- [ ] `readMachineConfigDocument`/`loadMachineConfig` default to `~/.jarvis/config.json`.
- [ ] `cli.ts`'s `DEFAULT_MACHINE_CONFIG_PATH` points at `~/.jarvis/config.json`.
- [ ] All `~/.jarvis/v2.json` references removed from `v2/src` (code and tests use `config.json` fixtures).
- [ ] `agents` schema/validation (`validateMachineConfigAgents`) unchanged — same ordered, non-empty, no-duplicate string array contract.

## Acceptance criteria

- [x] `jarvis config show` reads the agent fallback order from `~/.jarvis/config.json`.
- [x] `jarvis config path` prints `~/.jarvis/config.json`.
- [x] `jarvis config set-agents <csv>` writes `agents` into `~/.jarvis/config.json`, preserving any other keys already present in that file (e.g. `projects`, `machineProfile`).
- [x] `jarvis write`/`jarvis run start` fall back to `agents` from `~/.jarvis/config.json` when `--agents` is not passed on the command line.
- [x] No code path in `v2/src` reads or writes `~/.jarvis/v2.json`.

## Documentation updates

- Update `v2/docs/agent-model-config.md` to describe `agents` as a top-level key in `~/.jarvis/config.json`, replacing all `~/.jarvis/v2.json` references.
- Update `v2/docs/v2-architecture.md`'s `~/.jarvis/v2.json` references to `~/.jarvis/config.json`.
- Update `v2/docs/v1-behaviors.md`'s entry describing `jarvis config` targeting `~/.jarvis/v2.json` distinct from v1's `config.json` — the two are now the same file; record this behavior change.
