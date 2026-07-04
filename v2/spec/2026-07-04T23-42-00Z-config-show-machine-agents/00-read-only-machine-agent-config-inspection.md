# Read-only machine agent config inspection

Add `jarvis config show` / `jarvis config path` coverage for the v2 per-machine
agent fallback file so the operator can inspect the default `agents` order
without opening JSON by hand.

## Decisions

- The surface is `jarvis config show` / `jarvis config path`; rules out adding parallel `jarvis1 config` aliases for the same v2 machine-config read path.
- `jarvis config show` reports only the ordered `agents` list from `~/.jarvis/v2.json` or a clear no-override result; rules out printing role→model bindings or workflow config in the same command.
- `jarvis config path` prints the v2 machine-config path `~/.jarvis/v2.json`; rules out pointing at v1 `~/.jarvis/config.json` or the machine-independent role→model data file.
- These subcommands are read-only inspection of persisted defaults; rules out changing `--agents` precedence or runtime fallback resolution.
- Durable operator-facing command semantics live in `v2/docs/agent-model-config.md`; rules out duplicating the detailed command contract in `v2/docs/v2-architecture.md`.

## Task checklist

- [ ] Add CLI read-only `config show` / `config path` handling for the v2 machine agent-order file.
- [ ] Define the operator-facing output for present and absent `~/.jarvis/v2.json` machine overrides without expanding into role→model or workflow config inspection.
- [ ] Document the command semantics in the required durable docs home and keep the architecture doc to a focused cross-link.

## Acceptance criteria

- [ ] `jarvis config show` prints the current ordered `agents` list from `~/.jarvis/v2.json` when the machine override exists.
- [ ] `jarvis config show` clearly indicates that no machine override is present when `~/.jarvis/v2.json` is absent, without printing unrelated role→model bindings or workflow config.
- [ ] `jarvis config path` prints the machine-config path `~/.jarvis/v2.json`.
- [ ] `jarvis write` / `jarvis run start` agent resolution still follows CLI `--agents` > machine config `agents` > `DEFAULT_WRITE_AGENTS` after the read-only config subcommands land.

## Documentation updates

- [ ] Update [`v2/docs/agent-model-config.md`](../../docs/agent-model-config.md) with the durable operator-facing semantics for `jarvis config show` and `jarvis config path` on the v2 machine agent fallback file.
- [ ] Update [`v2/docs/v2-architecture.md`](../../docs/v2-architecture.md) to cross-link the focused show/edit surface without expanding into broader workflow drill-down.
