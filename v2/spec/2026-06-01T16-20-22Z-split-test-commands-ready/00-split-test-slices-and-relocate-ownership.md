# Split test slices and scope them by owner directory

## Decisions

- Keep `test` as the full-repo entrypoint (bare `bun test`, independent discovery); making `test:all` the only aggregate command is the wrong alternative.
- Add `test:v1`, `test:v2`, `test:shared` scoped to **exact** roots (`bun test ./v1/`, `./v2/`, `./shared/`); a bare `bun test shared` substring filter cross-contaminates slices and is the wrong alternative.
- The tree is already cleanly owner-split (shared in `shared/`, v2 in `v2/src`, v1 in `v1/test`) and `scripts/` has no tests — nothing to relocate. Add a guard test that no shared-owned test sits under `v1/test/` instead.
- The 30s timeout comes from `bunfig.toml` and is inherited by every `bun test`; do not re-add a per-script `--timeout` flag.
- The agent-spawn safety preload (`v1/test/setup-fake-agents.ts`) is repo-wide infra; relocate it to a neutral root home and repoint `bunfig.toml`'s `preload`, keeping it global for all slices.

## Tasks

- Add root scripts: `test:v1` (`bun test ./v1/`), `test:v2` (`bun test ./v2/`), `test:shared` (`bun test ./shared/`), aggregate `test` (`bun test`).
- Move `v1/test/setup-fake-agents.ts` to a neutral root home and update `bunfig.toml`'s `preload` path.
- Add a guard test that the three exact-scoped slices are non-overlapping (no test file resolves into more than one slice), plus coverage that each `test:*` script targets its exact root and `test` is bare `bun test`.

## Documentation updates

- Update `v2/docs/v1-behaviors.md` with the root test-command contract, exact-root scoping, the `shared` slice boundary, and the relocated preload.

## Acceptance criteria

- [ ] Root `package.json` exposes runnable `test:v1`, `test:v2`, `test:shared`, and aggregate `test` scripts.
- [ ] Each `test:*` script targets its exact owner root (`./v1/`, `./v2/`, `./shared/`); the aggregate `test` is bare `bun test`.
- [ ] The agent-spawn safety preload lives at a neutral root home, `bunfig.toml` points at it, and the 30s timeout still applies to every slice.
- [ ] A guard test fails if the slices overlap (a test file resolving into two slices).
- [ ] Automated tests fail on script-name or slice-scoping regressions (assert the exact script command strings).
- [ ] `v2/docs/v1-behaviors.md` records the operator-facing test-command contract and shared-slice ownership rule.
