---
name: shared-drop-production-invert-hooks
---

# Shared production code drops invert-for-test hooks

## Problem

`shared/module-boundary-surfaces.ts` exports `setInvertPartitionGuardForTest` so plan-split
partition guard-inversion ACs pass without mutating the real partition filter.

## Decisions

- Remove `setInvertPartitionGuardForTest` and its module variable; rewrite `module-boundary-surfaces.test.ts` guard-inversion to a comment-checkpoint source mutation — rules out leaving shared as an evasion path for the static guard.
- Plan-split partition tests keep both truth directions via mutation on the real guard line — rules out deleting inversion coverage.

## Acceptance criteria

- [ ] `shared/**/*.ts` outside `*.test.ts` exports no `setInvert*ForTest` and declares no `invert*ForTest` module variables.
- [ ] `module-boundary-surfaces.test.ts` test `inverting partition guard fails k2 draft-scope preservation` fails when its named mutation is inverted.
- [ ] `bun run typecheck` and `bun run test:v2` pass for touched shared files.

## Documentation updates

- None — shared guard-inversion doc already updated by the write-step-rules intent.

## Prerequisites

- Plan and implement write-step rules name comment-checkpoint source mutation and forbid production invert hooks.
