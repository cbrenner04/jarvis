---
name: lossless-git-status-inventory
---

# Lossless shared Git status inventory

## Prerequisites

## Problem

- V2 path consumers hand-parse newline-delimited porcelain output, which cannot represent all valid paths safely.

## Behavior

- Shared Git tooling inventories `git status --porcelain=v1 -z --untracked-files=all` as typed entries with status, current path, and original path for renames.
- Status inventory preserves spaces, newlines, non-ASCII text, and rename endpoints without trimming or quote artifacts.

## Decisions

- Put the inventory contract in the existing cross-cutting `shared/git.ts` utility; rules out duplicate helpers in execution and cleanup.
- Use NUL-delimited porcelain v1 as the only path-record protocol; rules out newline splitting, C-quote decoding, and path trimming.
- Return typed entries instead of path-only strings; rules out discarding rename origin or reparsing status codes in consumers.

## Acceptance criteria

- [ ] Unit tests pin ordinary statuses, renames, spaces, newlines, non-ASCII paths, and exact leading/trailing whitespace.
- [ ] A Git fixture pins nested files under an untracked directory as separate entries and fails when `--untracked-files=all` is omitted.
- [ ] The helper invokes `git status --porcelain=v1 -z --untracked-files=all` and returns typed status entries without trimming path fields.
- [ ] `bun run typecheck`, `bun run test:v1`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/coding-standards.md` — require path-aware Git status consumers to use the shared inventory.
