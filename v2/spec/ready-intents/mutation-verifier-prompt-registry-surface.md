---
name: mutation-verifier-prompt-registry-surface
---

# Mutation verifier resolves prompts through the registry module

## Prerequisites

## Primary implementation surface

- Execution-loop diff-derived mutation verification in `v2/src/execution/diff-derived-mutation-verifier.ts`

## Problem

- `diff-derived-mutation-verifier` textually re-parses `prompts/registry.txt` to discover registered prompt paths, duplicating the registry loader and drifting when manifest parsing changes.

## Behavior

- Registered prompt path discovery for mutation coverage uses the shared registry module (or a path list the registry exposes), not a local manifest parser.
- Worktree and base-ref registry resolution keep today's union semantics for retired prompts.

## Decision ledger

- Expose registered artifact paths from `shared/prompts/registry.ts` and consume that surface in the verifier; rules out a second `registry.txt` parser in execution-loop code.
- Preserve worktree/base union behavior for prompts retired from the current manifest; rules out narrowing coverage to worktree-only paths.

## Acceptance criteria

- [ ] `diff-derived-mutation-verifier.test.ts` proves registered prompt paths are resolved through the registry surface against a registry fixture and fails if the verifier falls back to textual `registry.txt` parsing.
- [ ] `diff-derived-mutation-verifier.test.ts` — `does not require render coverage for prompts retired from the worktree registry` stays green.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates
