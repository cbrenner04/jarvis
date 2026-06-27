# Split autofix from ready

## Problem

`bun run ready` mutates the tree before strict verification. A local green can hide CI red on the committed tree.

## Scope

This subspec changes the built-in Bun scripts and the docs that describe their default ready/fix workflow. It does not add harness-level post-ready dirty-worktree handling and does not constrain custom `readyCommand` overrides.

## Decisions

- Add built-in `bun run fix` as the only built-in autofix entrypoint for `check:fix:unsafe` - rules out a safe-only fixer or hidden built-in ready mutation.
- Leave custom `readyCommand` behavior out of scope - rules out changing operator overrides while splitting built-in scripts.
- Pin full-tier order as install when needed, strict Biome check, typecheck, aggregate test, markdown lint - rules out deferred or CI-order-mirroring semantics.
- Keep `fast` as `typecheck` plus aggregate `test` only - rules out widening the quick gate.
- Make `v2/docs/v1-behaviors.md` the authoritative ready/fix split record - rules out duplicating conflicting step semantics across v1 docs.

## Tasks

- Add the `fix` package script.
- Change `ready` full tier to strict verification only.
- Keep install digest behavior and test-step serial retry behavior unchanged.
- Update ready-script regression coverage.
- Align durable docs that describe built-in ready/fix semantics, including stale mutating-ready text.

## Acceptance criteria

- [x] `bun run fix` invokes the existing unsafe Biome autofix command.
- [x] `bun run ready` full tier never invokes `check:fix`, `check:fix:unsafe`, or any other `:fix` script.
- [x] `bun run ready` full tier still runs frozen install when the digest requires it, then strict Biome check, typecheck, aggregate test with the existing serial retry, and markdown lint.
- [x] `JARVIS_READY_TIER=fast bun run ready` remains `typecheck` plus aggregate `test` only.
- [x] Ready-script tests cover the strict full tier, separate `fix` script, unchanged fast tier, and unchanged serial retry behavior.
- [x] Built-in ready/fix script behavior changes do not alter documented custom `readyCommand` override semantics.
- [x] `v2/docs/v1-behaviors.md` records `ready` as strict CI-parity verification and `fix` as the separate pre-gate autofix entrypoint.
- [x] Other durable docs that name ready/fix step semantics align or cross-link to `v2/docs/v1-behaviors.md` without reintroducing conflicting step-by-step semantics.
- [x] `v1/docs/worktrees-and-commits.md` no longer describes built-in `ready` as mutating or committing `check:fix` output.
- [x] `bun run typecheck` passes.
- [x] `bun run test` passes.

## Documentation updates

- `v2/docs/v1-behaviors.md` - authoritative ready/fix behavior record.
- `v1/docs/run-loop.md` - align or cross-link only.
- `v1/docs/plan-mode.md` - align or cross-link only.
- `v1/docs/workflows.md` - align or cross-link only.
- `v1/docs/operator-runbook.md` - align or cross-link only.
- `v1/docs/worktrees-and-commits.md` - align or cross-link only.
