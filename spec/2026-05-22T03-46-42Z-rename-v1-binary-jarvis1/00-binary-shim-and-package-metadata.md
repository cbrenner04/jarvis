# 00 — Binary shim and package metadata

Rename the v1 entry-point shim from `bin/jarvis` to `bin/jarvis1` and update `package.json` to advertise the new name. This is the foundation for every subsequent subspec: tests and docs reference the shim by file and by package bin key, so the file and metadata must move first.

## Decisions

- `bin/jarvis1` is created with identical content to the current `bin/jarvis`. The old `bin/jarvis` is deleted with no compatibility alias.
- `package.json` `bin` field changes from `{ "jarvis": "bin/jarvis" }` to `{ "jarvis1": "bin/jarvis1" }`. The `name: "jarvis"` field is unchanged (repo identity).
- `bun install` is run after the `package.json` change. The lockfile is committed only if Bun changes it.

## Task checklist

- [ ] Copy `bin/jarvis` to `bin/jarvis1`, preserving content and executable bit
- [ ] Delete `bin/jarvis`
- [ ] Update `package.json` `bin` field: `"jarvis"` key → `"jarvis1"`, value `"bin/jarvis"` → `"bin/jarvis1"`
- [ ] Run `bun install`; commit `bun.lock` if changed

## Acceptance criteria

- [ ] `bin/jarvis1` exists and is executable (`-x` check passes)
- [ ] `bin/jarvis` does not exist
- [ ] `package.json` contains `"jarvis1": "bin/jarvis1"` in the `bin` field and does not contain a `"jarvis"` key in `bin`
- [ ] `bun run typecheck` passes

Note: `bun test` is not gated here because `v1/test/cli.test.ts` still references `bin/jarvis` until subspec 02 applies its symlink path updates. Full `bun test` pass is verified as part of subspec 02's acceptance criteria.

## Documentation updates

No documentation changes in this subspec. README and docs are updated in subspec 03.
