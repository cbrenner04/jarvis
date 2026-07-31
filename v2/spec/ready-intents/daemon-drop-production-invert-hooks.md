---
name: daemon-drop-production-invert-hooks
---

# Daemon production code drops invert-for-test hooks

## Problem

Daemon modules export `setInvert*ForTest` hooks and thread `invert*` parameters and
`invert*ForTest` type members (e.g. `invertRegistryReleaseBeforeKill` in `daemon.ts`) so
guard-inversion ACs pass without mutating real guards (`pipeline-stage-resolve`,
`pipeline-execution`, `daemon.ts`).

## Decisions

- Remove every daemon-surface `setInvert*ForTest` export, `invert*ForTest` module variable, `invert*` function parameter, and `invert*ForTest` type member; rewrite pinning tests to comment-checkpoint source mutations — rules out retaining hooks or parameter plumbing for expedience.
- Guard-inversion subcases name the mutation in a comment on the pinning test — rules out tautological setter calls.
- `pipeline-end-to-end.sandbox-unrunnable.test.ts` inversions use source mutation, not imported setters — rules out sandbox-only exceptions.

## Acceptance criteria

- [ ] `v2/src/daemon/**/*.ts` outside `*.test.ts` carry no forbidden invert hooks in any of the four shapes; existing guard-inversion tests still RED on source mutation and pass on the real guard.
- [ ] Inverting the admission-context handoff guard-inversion mutation in `daemon-pipeline-start.test.ts` fails its pinning test.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass for touched daemon files.

## Documentation updates

- None — `write-step-rules-forbid-production-invert-hooks` owns the operator-facing guard-inversion doc.

## Prerequisites

- Plan and implement write-step rules name comment-checkpoint source mutation and forbid production invert hooks.
