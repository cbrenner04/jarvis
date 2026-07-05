# Machine config loader for agent fallback order

Read the per-machine `agents: Agent[]` outer fallback order from
`~/.jarvis/v2.json`, per the storage split in
[`v2/docs/agent-model-config.md`](../../docs/agent-model-config.md). This is a
new file, separate from v1's `~/.jarvis/config.json`.

## Decisions

- On-disk path: `~/.jarvis/v2.json`, shape `{ "agents": string[] }`.
- Missing file, or the file parses but has no top-level `agents` key, returns `undefined` (no override).
- Present but structurally invalid — unparseable JSON, `agents` not an array, a non-string entry, a duplicate name, or an empty array — throws (hard load error). Only true absence returns `undefined`.
- No validation against a fixed agent-name enum; any non-empty, non-duplicate string is accepted.
- Duplicate detection is exact-string comparison — no trimming or case-folding.
- An empty-string entry is invalid on its own, independent of the empty-array check.
- The loader returns `agents` in on-disk array order, unmodified — order is fallback priority.
- Loader takes the config path as a parameter (default `~/.jarvis/v2.json`) so tests can point at a fixture file instead of the real home directory.

## Task checklist

- [ ] Add a machine-config loader module under `v2/src/` that reads and parses the file per the decisions above.
- [ ] Unit tests: absent file → `undefined`; file present with no `agents` key → `undefined`; valid `agents` list → returned as-is, order preserved; each invalid shape (bad JSON, non-array, non-string entry, empty-string entry, duplicate, empty array) → throws.

## Acceptance criteria

- [x] Loading a nonexistent config path returns `undefined`.
- [x] Loading a config file with valid JSON but no `agents` key returns `undefined`.
- [x] Loading a config file with a valid `agents: string[]` returns that list in on-disk order.
- [x] Loading a config file with unparseable JSON, a non-array `agents`, a non-string entry, an empty-string entry, a duplicate name (exact-string match), or an empty `agents` array throws.
- [x] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- Update [`v2/docs/agent-model-config.md`](../../docs/agent-model-config.md) storage-split section with the concrete on-disk path (`~/.jarvis/v2.json`) and shape (`{ "agents": string[] }`) for the agent fallback order, replacing the generic "per-machine `~/.jarvis` project config" description.
