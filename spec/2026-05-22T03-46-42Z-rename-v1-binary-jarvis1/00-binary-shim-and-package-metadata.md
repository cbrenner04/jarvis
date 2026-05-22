# 00 — Binary shim and package metadata

Rename the v1 entry-point shim from `bin/jarvis` to `bin/jarvis1` and update `package.json` to advertise the new name. This subspec owns only the executable entrypoint boundary; user-facing strings, tests, and docs move in later subspecs.

## Decisions

- `bin/jarvis1` is created with identical content to the current `bin/jarvis`, preserving the symlink-friendly shim behavior and executable bit.
- `bin/jarvis` is deleted. Do not leave a compatibility alias from `jarvis` to v1.
- `package.json` changes only its `bin` map from `{ "jarvis": "bin/jarvis" }` to `{ "jarvis1": "bin/jarvis1" }`. The package `name` remains `jarvis`.
- Run `bun install` after updating `package.json`; keep the resulting `bun.lock` change only if Bun rewrites it.

## Task checklist

- [ ] Create `bin/jarvis1` with the same contents as `bin/jarvis`
- [ ] Preserve the executable bit on `bin/jarvis1`
- [ ] Delete `bin/jarvis`
- [ ] Update the `package.json` `bin` map to publish `jarvis1`
- [ ] Run `bun install` and keep `bun.lock` only if it changes

## Acceptance criteria

- [ ] `bin/jarvis1` exists, is executable, and contains the same shim logic that previously lived in `bin/jarvis`
- [ ] `bin/jarvis` is absent from the working tree
- [ ] `package.json` publishes `bin/jarvis1` under the `jarvis1` key and no longer publishes a `jarvis` bin key
- [ ] If `bun install` rewrites `bun.lock`, the updated lockfile is included; if it does not, `bun.lock` is unchanged
- [ ] `bun run typecheck` passes

## Documentation updates

No documentation changes in this subspec. README and docs are updated in subspec 03.
