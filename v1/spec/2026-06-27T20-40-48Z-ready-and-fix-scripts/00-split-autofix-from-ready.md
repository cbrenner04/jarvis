# Split autofix from ready

## Problem

`bun run ready` mutates the tree before strict verification. A local green can hide CI red on the committed tree.

## Decisions

- Add `bun run fix` as the only autofix entrypoint for `check:fix:unsafe` - rules out a safe-only fixer or hidden ready-gate mutation.
- Remove all `:fix` invocations from `ready` full tier - rules out committing formatter/linter output as part of verification.
- Keep `fast` as `typecheck` plus aggregate `test` only - rules out widening the quick gate.
- Deferred to first consumer: exact full-tier verification order after install - pin when a caller needs it.

## Tasks

- Add the `fix` package script.
- Change `ready` full tier to strict verification only.
- Keep install digest behavior and test-step serial retry behavior unchanged.
- Update ready-script regression coverage.
- Align durable ready/fix docs.

## Acceptance criteria

- [ ] `bun run fix` invokes the existing unsafe Biome autofix command.
- [ ] `bun run ready` full tier never invokes `check:fix`, `check:fix:unsafe`, or any other `:fix` script.
- [ ] `bun run ready` full tier still runs frozen install when the digest requires it, then strict Biome check, typecheck, aggregate test with the existing serial retry, and markdown lint.
- [ ] `JARVIS_READY_TIER=fast bun run ready` remains `typecheck` plus aggregate `test` only.
- [ ] Ready-script tests cover the strict full tier, separate `fix` script, unchanged fast tier, and unchanged serial retry behavior.
- [ ] `v2/docs/v1-behaviors.md` records `ready` as strict CI-parity verification and `fix` as the separate pre-gate autofix entrypoint.
- [ ] Existing durable docs that name ready/fix step semantics are aligned with the new split.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test` passes.

## Documentation updates

- `v2/docs/v1-behaviors.md`
- `v1/docs/run-loop.md`
- `v1/docs/plan-mode.md`
- `v1/docs/workflows.md`
- `v1/docs/operator-runbook.md`
