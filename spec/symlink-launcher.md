# Symlink launcher fix

`bin/jarvis` should work when symlinked onto `PATH`, as documented in the
README.

## Tasks

- [x] Update `bin/jarvis` so it resolves the real script location before
  building the path to `src/cli.ts`.
- [x] Add a regression test that invokes `bin/jarvis` through a symlink.
- [x] Confirm the README installation instructions still match the behavior.

## Acceptance criteria

- `jarvis help` works when `jarvis` is a symlink in another directory.
- `bun run typecheck` passes.
- `bun test` passes.

## Documentation updates

- No README change is expected unless the symlink command changes.
