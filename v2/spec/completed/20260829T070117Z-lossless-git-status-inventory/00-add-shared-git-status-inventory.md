# Add the shared Git status inventory

## Problem

V2 path consumers parse newline-delimited porcelain output, which cannot represent every valid Git path or rename/copy endpoint without trimming or quote artifacts. `shared/git.ts` has no status inventory today; the regressions fail on main because the export is missing, not because a shared newline parser already exists.

## Decision ledger

- Put the inventory contract in `shared/git.ts`; rules out duplicate execution and cleanup helpers.
- Run `git status --porcelain=v1 -z --untracked-files=all` asynchronously through `AsyncSubprocessRunner`; rules out synchronous V2 subprocesses and newline-delimited path transport.
- Preserve exact valid UTF-8 path text for current and original endpoints; rules out trimming, C-quote decoding, and claiming arbitrary filename-byte preservation beyond the string-returning runner interface.
- Parse all two-path porcelain records — renames and copies indicated in either status column — in NUL-mode field order (current path then original path); rules out arrow parsing and desynchronizing subsequent records.
- Expose typed status semantics (staged/worktree columns and rename/copy kind) plus unambiguous original-path presence; rules out returning only an opaque two-character status or path-only strings.
- Reject malformed NUL output (truncated records, missing rename/copy origins, missing terminal NUL framing) instead of silently emitting incorrect entries; subprocess failure keeps the runner's existing rejection semantics.
- Keep dependent consumer migrations out of scope; rules out coupling this shared contract to independently reviewable execution or cleanup changes.
- Use a real temporary Git repository for the nested-untracked regression; rules out canned runner output that cannot prove Git behavior.
- Use injected runner fixtures for porcelain parsing and malformed-output regressions; rules out subprocess coupling for those cases.
- Deferred to first consumer: consumer-specific path projections and filters — pin when a caller needs it.

## Tasks

- Add the typed asynchronous status inventory to `shared/git.ts`, issuing the exact porcelain-v1 NUL command and preserving status and UTF-8 path fields without normalization.
- Parse ordinary, rename, and copy records; preserve pathological characters and leading/trailing whitespace in both current and original endpoints for two-path records.
- Reject malformed NUL output with tests for truncated records, missing rename/copy origins, and missing terminal NUL framing.
- Add the named regressions to `shared/git.test.ts`: injected-fixture preservation and malformed-output tests with source `// @mutate` checkpoints; real-repo nested-untracked test with a keystone checkpoint.
- Update the durable coding standard below for new or migrated consumers only.

## Acceptance criteria

- [x] `shared/git.test.ts` test `inventory preserves typed porcelain entries including exact UTF-8 path text` proves ordinary statuses, rename and copy records from either status column, spaces, newlines, non-ASCII paths, and leading/trailing whitespace in both current and original rename/copy endpoints; it fails on main because the shared inventory export is absent.
- [x] `shared/git.test.ts` test `inventory expands nested untracked files` uses a real temporary Git repository, lists each nested untracked file individually, and fails when the inventory command omits `--untracked-files=all`.
- [x] `shared/git.test.ts` test `inventory rejects malformed porcelain output` proves truncated records, missing rename/copy origins, and missing terminal NUL framing are rejected instead of producing incorrect entries.
- [x] The shared inventory returns typed staged/worktree status semantics, rename/copy kind, current-path, and original-path-when-present values from `git status --porcelain=v1 -z --untracked-files=all` without altering UTF-8 path fields.
- [x] `shared/git.test.ts` — `inventory expands nested untracked files`; Keystone checkpoint: the test body carries a source `// @mutate` directive that removes `--untracked-files=all` from the inventory command, and the scoped test turns RED under that mutation.
- [x] `shared/git.test.ts` — `inventory preserves typed porcelain entries including exact UTF-8 path text`; Mutation checkpoint: the test body carries a source `// @mutate` directive that disables two-path record parsing (current path then original path), and the scoped test turns RED under that mutation.
- [x] `shared/git.test.ts` — `inventory preserves typed porcelain entries including exact UTF-8 path text`; Mutation checkpoint: the test body carries a source `// @mutate` directive that disables rename/copy kind detection, and the scoped test turns RED under that mutation.
- [x] `shared/git.test.ts` — `inventory rejects malformed porcelain output`; Mutation checkpoint: the test body carries a source `// @mutate` directive that bypasses the truncated-record guard, and the scoped test turns RED under that mutation.
- [x] `shared/git.test.ts` — `inventory rejects malformed porcelain output`; Mutation checkpoint: the test body carries a source `// @mutate` directive that bypasses the missing-rename-or-copy-origin guard, and the scoped test turns RED under that mutation.
- [x] `shared/git.test.ts` — `inventory rejects malformed porcelain output`; Mutation checkpoint: the test body carries a source `// @mutate` directive that bypasses the missing-terminal-NUL guard, and the scoped test turns RED under that mutation.
- [x] `v2/docs/coding-standards.md` requires new or migrated path-aware Git status consumers to use the shared typed inventory instead of parsing porcelain output independently.
- [x] `bun run typecheck`, `bun run test:v1`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/coding-standards.md` — require new or migrated path-aware Git status consumers to use the shared typed inventory.
