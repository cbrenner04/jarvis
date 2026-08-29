---
name: lossless-git-status-inventory
---

# Lossless shared Git status inventory

## Prerequisites

## Problem

- V2 path consumers hand-parse newline-delimited porcelain output, which cannot represent all valid paths safely.

Unsplit rationale: The shared Git inventory is one cross-cutting utility contract; dependent consumer migrations remain separate intents.

## Primary implementation surface

- execution-loop

## Behavior

- Shared Git tooling inventories `git status --porcelain=v1 -z --untracked-files=all` as typed entries with status, current path, and original path for renames.
- Status inventory preserves spaces, newlines, non-ASCII text, and rename endpoints without trimming or quote artifacts.

## Decisions

- Put the inventory contract in the existing cross-cutting `shared/git.ts` utility; rules out duplicate helpers in execution and cleanup.
- Use NUL-delimited porcelain v1 as the only path-record protocol; rules out newline splitting, C-quote decoding, and path trimming.
- Return typed entries instead of path-only strings; rules out discarding rename origin or reparsing status codes in consumers.

## Acceptance criteria

- [ ] `shared/git.test.ts` test `inventory preserves typed porcelain entries including exact path bytes` proves ordinary statuses, renames, spaces, newlines, non-ASCII paths, and exact leading/trailing whitespace; it fails against the pre-fix newline parser.
- [ ] `shared/git.test.ts` test `inventory expands nested untracked files` proves a Git fixture lists each nested untracked file and fails when the command omits `--untracked-files=all`.
- [ ] The shared inventory returns typed status, current-path, and rename-original-path values from `git status --porcelain=v1 -z --untracked-files=all` without altering path fields.
- [ ] `shared/git.test.ts` — `inventory expands nested untracked files`; Keystone checkpoint:
- [ ] `shared/git.test.ts` — `inventory preserves typed porcelain entries including exact path bytes`; Mutation checkpoint:
- [ ] `bun run typecheck`, `bun run test:v1`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/coding-standards.md` — require path-aware Git status consumers to use the shared inventory.
