---
name: cli-drop-production-invert-hooks
---

# CLI production code drops invert-for-test hooks

## Problem

CLI modules (`workflow`, `run`, `run-list-rpc`, `pipeline`, `cleanup`) export `setInvert*ForTest`
hooks and thread `invert*` parameters (e.g. `invertGuard` in `pipeline.ts`) so guard-inversion ACs
pass without mutating real admission, list, wait, or cleanup guards.

## Decisions

- Remove every CLI-surface `setInvert*ForTest` export, `invert*ForTest` module variable, `invert*` function parameter, and `invert*ForTest` type member; rewrite pinning tests to comment-checkpoint source mutations — rules out allowlisting shipped hooks or parameter plumbing for a later pass.
- Cross-imported daemon invert setters used only from CLI tests are removed with the owning production export, not re-exported — rules out CLI tests calling daemon setters after daemon cleanup.

## Acceptance criteria

- [ ] `v2/src/commands/**/*.ts` outside `*.test.ts` carry no forbidden invert hooks in any of the four shapes; guard-inversion tests for CLI guards still RED on source mutation.
- [ ] Inverting the pre-admission resolution guard-inversion mutation in `pipeline.test.ts` fails its pinning test.
- [ ] `bun run typecheck` and `bun run test:v2` pass for touched CLI files.

## Documentation updates

- None — shared guard-inversion doc already updated by the write-step-rules intent.

## Prerequisites

- Plan and implement write-step rules name comment-checkpoint source mutation and forbid production invert hooks.
- Daemon production modules carry no forbidden invert hooks in any shape.
