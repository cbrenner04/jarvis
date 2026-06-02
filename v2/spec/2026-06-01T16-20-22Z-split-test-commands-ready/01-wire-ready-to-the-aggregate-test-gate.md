# Wire ready to the aggregate test gate

## Decisions

- Make `scripts/ready.ts` invoke `bun run test` once for the test phase; duplicating per-slice test commands inside `ready` is the wrong alternative.
- Record the ready-gate test-step contract in `v2/docs/v1-behaviors.md` and keep `v1/docs/worktrees-and-commits.md` as a cross-reference; treating the procedural page as the sole source of truth is the wrong alternative.

## Tasks

- Update `scripts/ready.ts` so its test step runs the aggregate root test script instead of an independent slice list.
- Add ready-script regression coverage for command order and the aggregate test invocation name.
- Align `v1/docs/worktrees-and-commits.md` with that durable entry.

## Documentation updates

- Extend `v2/docs/v1-behaviors.md` with the ready-gate test-step contract.
- Update `v1/docs/worktrees-and-commits.md` to point at that durable home when describing `bun run ready`.

## Acceptance criteria

- [ ] `scripts/ready.ts` keeps the existing ready order and runs the test phase through `bun run test`.
- [ ] Automated tests fail if `ready` stops using the aggregate test script or reorders the ready steps unexpectedly.
- [ ] `v2/docs/v1-behaviors.md` records that `bun run ready` reaches tests through the aggregate root `test` command.
- [ ] `v1/docs/worktrees-and-commits.md` cross-references the durable behavior entry instead of carrying the only operator contract for the ready test step.
