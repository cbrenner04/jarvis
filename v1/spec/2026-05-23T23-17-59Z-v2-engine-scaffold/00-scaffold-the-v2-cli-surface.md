# 00 - Scaffold the v2 CLI surface

Phase 0 starts by giving `v2/` a real TypeScript entrypoint and a reserved
`jarvis` binary without pulling any later-phase behavior forward. This slice is
only the scaffold: a `v2/tsconfig.json`, a near-empty `v2/src/cli.ts`, one
co-located Bun test under `v2/src`, and the root package metadata needed for a
real `--version` response. It should stand on its own without touching the
repo-wide verification and import-boundary wiring, which belongs in the next
subspec.

## Decisions

- Keep `v2/` as a separate tsconfig project that extends
  `../tsconfig.base.json`, matching v1 strictness instead of introducing any
  new compiler baseline.
- Anchor the Phase 0 entrypoint at `v2/src/cli.ts`; add `v2/src/index.ts` only
  if the implementation needs an internal helper, not as the public contract.
- Add a root `package.json` `version` field and have `jarvis --version` print
  that exact string to stdout. Do not introduce git-derived versioning or build
  plumbing.
- Mirror `bin/jarvis1` literally for `bin/jarvis`: same symlink-resolution
  behavior and `exec bun run` shape, swapping only the target path to
  `v2/src/cli.ts`.
- Keep the Phase 0 CLI surface to two explicit success paths: no arguments and
  `--version`. Other argv shapes are out of scope unless the implementation
  chooses to normalize them to the same `v2 not ready` stdout/exit-0 boundary.
- Keep the root package boundary stable: do not repoint `module`, `start`, or
  exports at `v2` in this phase. The new surface is only the root `version`
  field, the additional `bin/jarvis` entry, and the new files under `v2/`.

## Task Checklist

- Add `v2/tsconfig.json` as a thin project wrapper over the shared base config.
- Add the minimal v2 CLI implementation and any tiny helper it needs under
  `v2/src/`.
- Add one co-located `v2/src/*.test.ts` smoke test that exercises the CLI
  module directly under Bun.
- Add `bin/jarvis` and register it in the root `package.json` `bin` map without
  disturbing `jarvis1`, `module`, or `start`.
- Add the root `package.json` `version` field used by the new CLI contract.
- Add the minimal discoverability note in an existing root-facing doc so readers
  can distinguish `jarvis1` from the new reserved `jarvis` shim.

## Acceptance criteria

- [ ] `v2/tsconfig.json` exists, extends `../tsconfig.base.json`, and scopes the
      v2 project to `v2/src/**/*.ts` so Phase 0 starts with a separate strict
      TypeScript tree.
- [ ] The root `package.json` gains a concrete `version` field, and this
      subspec does not otherwise repoint the package default module surface:
      `module`, `start`, and `jarvis1` remain v1-backed.
- [ ] `v2/src/cli.ts` implements the only required Phase 0 contract:
      `jarvis --version` writes the root package version string to stdout,
      writes nothing to stderr, and exits 0.
- [ ] The same CLI entry implements the no-arg Phase 0 boundary:
      `jarvis` writes the exact `v2 not ready` message to stdout, writes nothing
      to stderr, exits 0, and does not print help text, banners, or stack
      traces.
- [ ] `bin/jarvis` mirrors the existing `bin/jarvis1` shim structure
      byte-for-byte where practical, differing only in the final `exec bun run`
      target path, and the root `package.json` `bin` map exposes both
      `jarvis1` and `jarvis`.
- [ ] A co-located Bun test under `v2/src/*.test.ts` covers the CLI module
      directly for the no-arg and `--version` cases, asserting stdout, stderr,
      and exit-code behavior without introducing a new test script or separate
      `v2/test/` tree.
- [ ] One existing root-facing doc records the narrow command boundary for this
      phase: `jarvis1` remains the daily-driver v1 command, while bare
      `jarvis` now resolves to the intentionally minimal v2 scaffold.

## Documentation updates

- Update one existing root-facing doc, likely `README.md`, with the minimal
  command-discoverability note above. Do not add a standalone v2 usage guide.
