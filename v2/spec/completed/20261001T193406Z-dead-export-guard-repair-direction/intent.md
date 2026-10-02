---
name: dead-export-guard-repair-direction
---

# Dead-export guard stderr names demote-or-delete, not import-to-satisfy

## Problem

`scripts/guard-dead-exports.ts` prints only `<file>:<line>: unreferenced export <Name>`, so ready-gate repair agents satisfy the guard by importing dead symbols from paths outside the repair fence.

## Decisions

- Append fix direction to each finding: `(demote to module-private if used in-file, else delete; never add an import to satisfy the guard)`.
- Keep the `<file>:<line>:` prefix unchanged.

## Acceptance criteria

- [ ] `scripts/guard-dead-exports.test.ts`: an in-file-only export fails with the new message and intact prefix; fails against the old message-only line.
- [ ] `bun run typecheck` and `bun run test:shared` pass.

## Documentation updates

- `v2/docs/coding-standards.md` — show the new guard line format.

## Primary implementation surface

scripts/guard-dead-exports.ts

## Prerequisites
