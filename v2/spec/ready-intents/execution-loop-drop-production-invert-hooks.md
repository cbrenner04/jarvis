---
name: execution-loop-drop-production-invert-hooks
---

# Execution-loop production code drops invert-for-test hooks

## Problem

Execution-loop modules thread `invert*ForTest` through `WriteLoopInput`, function parameters
(`intent-output.ts`), and exported setters (`write-loop`, `workflow-runner`, `terminal-publication`,
`project-pipeline-resolution`, `external-worktree`, TUI filters) — the parameter shape survives
mutation verification (#2360).

## Decisions

- Remove every execution-loop and TUI production `setInvert*ForTest`, `invert*ForTest` module variable, `invert*` parameter, and `invert*ForTest` type member; rewrite tests to comment-checkpoint source mutations — rules out keeping `invertReadyGateRepairSidecarFenceForTest`-style plumbing.
- `WriteLoopInput` and helper option bags lose invert fields entirely — rules out renaming to non-`ForTest` suffixes to evade a future guard.
- `intent-output.ts` optional invert parameters are deleted; handoff guard inversion mutates the real predicate — rules out tautological `{ invertSingleFileGuardForTest: true }` calls.

## Acceptance criteria

- [ ] `v2/src/execution/**/*.ts` and `v2/src/tui/**/*.ts` outside `*.test.ts` carry no forbidden invert hooks in any of the four shapes; guard-inversion tests still RED on source mutation.
- [ ] Inverting the ready-gate repair sidecar-fence guard-inversion mutation (or equivalent highest-risk case) fails its pinning test.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass for touched execution and TUI files.

## Documentation updates

- None — shared guard-inversion doc already updated by the write-step-rules intent.

## Prerequisites

- Plan and implement write-step rules name comment-checkpoint source mutation and forbid production invert hooks.
- Daemon production modules export no `setInvert*ForTest` or `invert*ForTest` hooks.
- CLI production modules export no `setInvert*ForTest` or `invert*ForTest` hooks.
