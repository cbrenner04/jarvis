# Read-only machine agent config inspection

Add `jarvis config show` / `jarvis config path` coverage for the v2 per-machine
agent fallback file so the operator can inspect the default `agents` order
without opening JSON by hand.

## Decisions

- The surface is `jarvis config show` / `jarvis config path`; rules out adding parallel `jarvis1 config` aliases for the same v2 machine-config read path.
- `jarvis config show` has three outcomes only: prints the ordered `agents` list, prints a no-override line, or exits with a config-read error for malformed `~/.jarvis/v2.json`; rules out silently treating invalid JSON as no override.
- `jarvis config show` treats missing `~/.jarvis/v2.json` and present-without-`agents` the same as no machine override; rules out implying an active fallback order when the key is absent.
- `jarvis config show` prints one agent name per line in configured order when `agents` is present; rules out JSON echo, numbered output, or role→model/workflow detail in the same command.
- `jarvis config show` prints the literal line `No machine agent override configured.` for both absent-file and no-`agents` cases; rules out path-qualified or source-specific no-override wording.
- `jarvis config path` prints the expanded absolute machine-config path, not the literal `~/.jarvis/v2.json` token; rules out shell-dependent tilde interpretation in the output contract.
- These subcommands are read-only inspection of persisted defaults; rules out changing `--agents` precedence or runtime fallback resolution.
- Generic unknown-subcommand, usage, and parse-error behavior stays whatever the shared CLI surface already does; rules out this subspec inventing broader `config` parser semantics beyond successful `show` / `path` execution and malformed-config handling.
- Durable operator-facing command semantics live in `v2/docs/agent-model-config.md`, while `v2/docs/v2-architecture.md` narrows to the focused show/edit surface and defers broader config workflow drill-down; rules out conflicting `jarvis config <project> <workflow>` guidance persisting in architecture docs.

## Task checklist

- [ ] Add CLI read-only `config show` / `config path` handling for the v2 machine agent-order file.
- [ ] Define the operator-facing output for configured override, no override, and malformed `~/.jarvis/v2.json` without expanding into role→model or workflow config inspection.
- [ ] Treat file-without-`agents` as no override for inspection.
- [ ] Document the command semantics in the required durable docs homes and narrow the architecture doc away from conflicting broader `config` drill-down language.

## Acceptance criteria

- [x] With `~/.jarvis/v2.json` containing `{"agents":["claude","codex","cursor"]}`, `jarvis config show` exits successfully and prints exactly:
  `claude`
  `codex`
  `cursor`
- [x] When `~/.jarvis/v2.json` is absent, `jarvis config show` exits successfully and prints exactly `No machine agent override configured.`.
- [x] When `~/.jarvis/v2.json` exists without an `agents` key, `jarvis config show` exits successfully and prints exactly `No machine agent override configured.`.
- [x] When `~/.jarvis/v2.json` is malformed or fails v2 machine-config validation, `jarvis config show` exits non-zero with a config-read error instead of printing agent output or the no-override line.
- [x] `jarvis config path` exits successfully and prints the expanded absolute path to the machine config file for the current machine.
- [x] `jarvis write` / `jarvis run start` agent resolution still follows CLI `--agents` > machine config `agents` > `DEFAULT_WRITE_AGENTS` after the read-only config subcommands land.

## Documentation updates

- [x] Update [`v2/docs/agent-model-config.md`](../../docs/agent-model-config.md) with the durable operator-facing semantics for `jarvis config show` and `jarvis config path` on the v2 machine agent fallback file.
- [x] Update [`v2/docs/v1-behaviors.md`](../../docs/v1-behaviors.md) with the new v2-only `jarvis config show` / `jarvis config path` operator behavior and its relation to the v1 baseline.
- [x] Update [`v2/docs/v2-architecture.md`](../../docs/v2-architecture.md) to narrow config-surface language to the focused show/edit surface or explicitly defer broader config workflow drill-down elsewhere.
