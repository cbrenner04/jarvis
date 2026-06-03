# Split test slices and scope them by owner directory

## Decisions

- Keep `test` as the full-repo entrypoint (bare `bun test`, independent discovery); making `test:all` the only aggregate command is the wrong alternative.
- Add `test:v1`, `test:v2`, `test:shared` scoped to **exact** roots (`bun test ./v1/`, `./v2/`, `./shared/`); a bare `bun test shared` substring filter cross-contaminates slices and is the wrong alternative.
- The tree is already cleanly owner-split (shared in `shared/`, v2 in `v2/src`, v1 in `v1/test`) and `scripts/` has no tests — nothing to relocate. Guard it with a disjoint-roots test (enumerate test files; assert `v1/**`/`v2/**`/`shared/**` are disjoint), not a fuzzy "shared-owned" heuristic.
- The ownership rule is narrow: the preload must not live under `v1/test/`, and shared-owned *tests* live under `shared/`. v1/v2 tests importing `shared/**` runtime code is valid coverage, not a violation.
- The 30s timeout comes from `bunfig.toml` and is inherited by every `bun test`; do not re-add a per-script `--timeout` flag.
- The agent-spawn safety preload (`v1/test/setup-fake-agents.ts`) is repo-wide infra; relocate it to a neutral root home and repoint `bunfig.toml`'s `preload`, keeping it global for all slices. Prove it loads under a scoped slice run, not just in config text.
- `ready` already runs the aggregate via `bun run test`, and that command stays whole-repo `bun test`, so no `scripts/ready.ts` change is needed — only pin the contract with a regression and document it. Rewiring `ready` is the wrong alternative: it already reaches the aggregate.

## Tasks

- Add root scripts: `test:v1` (`bun test ./v1/`), `test:v2` (`bun test ./v2/`), `test:shared` (`bun test ./shared/`), aggregate `test` (`bun test`).
- Move `v1/test/setup-fake-agents.ts` to a neutral root home and update `bunfig.toml`'s `preload` path.
- Add a disjoint-roots guard test (enumerate test files; assert `v1/**`/`v2/**`/`shared/**` don't overlap), plus a regression asserting the exact script strings with trailing slashes (`bun test ./v1/`, `./v2/`, `./shared/`, `test` = bare `bun test`).
- Add a regression that a scoped slice run (`test:v2`/`test:shared`) still observes the agent-spawn preload — exercise the protected spawn path under a scoped invocation.
- Add a regression pinning `scripts/ready.ts` to reach tests via `bun run test` (the aggregate) and keep its step order, so a later refactor can't drop or reorder the test gate.

## Documentation updates

- Update `v2/docs/v1-behaviors.md` with the root test-command contract, exact-root scoping, the `shared` slice boundary, the relocated preload, and that `bun run ready` reaches tests through the aggregate root `test` command.
- Update `v1/docs/worktrees-and-commits.md` to cross-reference that durable behavior entry when describing `bun run ready`, rather than carrying the only operator contract for the ready test step.
- Fix README's "Per-test timeout" section to credit `bunfig.toml` (`[test] timeout = 30000`) instead of the removed `--timeout=30000` script flag.

## Acceptance criteria

- [ ] Root `package.json` exposes runnable `test:v1`, `test:v2`, `test:shared`, and aggregate `test` scripts.
- [ ] Each `test:*` script targets its exact owner root (`./v1/`, `./v2/`, `./shared/`); the aggregate `test` is bare `bun test`.
- [ ] The agent-spawn preload no longer lives under `v1/test/` (neutral root home, `bunfig.toml` points at it); the 30s timeout still applies to every slice. v1/v2 tests may still import `shared/**` runtime code.
- [ ] A disjoint-roots guard test fails if any test file resolves into two of `v1/**`/`v2/**`/`shared/**`.
- [ ] A regression asserts the exact script strings with trailing slashes (`bun test ./v1/`, `./v2/`, `./shared/`) and `test` = bare `bun test`, so dropping a trailing slash fails.
- [ ] A regression proves a scoped slice run (`test:v2`/`test:shared`) still loads the agent-spawn preload via the protected spawn path.
- [ ] `v2/docs/v1-behaviors.md` records the operator-facing test-command contract and shared-slice ownership rule; README's "Per-test timeout" section credits `bunfig.toml`, not the `--timeout` flag.
- [ ] `scripts/ready.ts` reaches the test phase through `bun run test` (the aggregate) with its existing step order; a regression fails if `ready` stops using `bun run test` or reorders the ready steps.
- [ ] `v2/docs/v1-behaviors.md` records that `bun run ready` reaches tests through the aggregate root `test` command, and `v1/docs/worktrees-and-commits.md` cross-references that entry instead of carrying the only operator contract for the ready test step.
