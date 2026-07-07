# v1 config.json preserves unknown top-level keys on write

v2 will store `machineProfile` and `agents` as top-level keys in
`~/.jarvis/config.json`. `v1/src/config.ts`'s `validateConfig` currently
rebuilds the returned `Config` from a fixed set of known fields — any
top-level key it doesn't recognize is silently dropped on the next
`loadConfig`/`writeConfig` round trip (e.g. via `registerProject`,
`setGit`). Without a fix, the first v1 command that writes config after v2
sets `machineProfile`/`agents` would wipe them out.

## Decisions

- `validateConfig` passes through unrecognized top-level keys verbatim into the returned object — v1 does not parse or type them, it only avoids destroying them.
- No new v1-side schema, enum, or validation for `machineProfile`/`agents` — v1 stays ignorant of their meaning, per the intent.

## Task Checklist

- [x] `validateConfig` retains unknown top-level keys (e.g. `machineProfile`, `agents`) unchanged in its return value.
- [x] `writeConfig`/`loadConfig` round trip no longer drops unknown top-level keys.

## Acceptance criteria

- [x] A `~/.jarvis/config.json` containing `machineProfile` and `agents` keys retains both, unchanged, after a v1 config write (e.g. `jarvis config set-git`).
- [x] Existing `v1/src/config.test.ts` coverage for known-key validation and strict nested-key rejection (`projects[name]`, `modes.patch`, etc.) stays green — only top-level unknown-key handling changes.

## Documentation updates

- Update `v1/docs/config.md` to note that top-level keys outside the documented schema (reserved for v2, e.g. `machineProfile`, `agents`) are preserved across writes, not validated.
