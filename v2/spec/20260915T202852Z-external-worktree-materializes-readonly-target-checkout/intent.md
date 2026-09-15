---
name: external-worktree-materializes-readonly-target-checkout
---

# Materialize a read-only target-repo checkout for git-less external worktree stages

## Problem

`withExternalWorktree` on the `git === false && localPath` branch only `mkdirSync`s the external stage dir (`v2/src/execution/external-worktree.ts:93-100`); it never checks out the target repo. A caller that needs the draft agent to read committed target-repo code at the resolved base gets a scratch directory holding only seeded input, not a repo. `getExternalWorktreePath` returns `localPath` unchanged for this branch (`external-worktree.ts:70`), so the advertised cwd is a bare stage dir with no repo on disk.

## Decisions

- The git-less external-worktree stage can be materialized as a read-only checkout of the target repo at the resolved base, so the callback's cwd is a readable repo checkout rather than an empty scratch dir. Delivering the repo as cwd means every configured vendor reads it natively (opencode via `--dir`, claude/codex via cwd) with no per-vendor argv read-dir grant.
- The materialized checkout lives at the stage `localPath` the caller already passes, so the advertised path and the invocation cwd are the same on-disk directory; rules out advertising an unmaterialized path while the agent runs elsewhere.
- The existing genuinely git-less path (no repo to check out, used by tests) stays available; materialization is opt-in via the caller's input, not forced onto every `git: false` run. Defaults preserve today's behavior for callers that do not request a read context.
- Persistence of any drafted tree remains the caller's concern (it stages/persists separately); this surface only guarantees a readable repo checkout at cwd.

## Acceptance criteria

- [ ] A test drives the git-less external-worktree branch with a read-context request against a real git fixture and asserts the callback's cwd exists and is a readable checkout of the target repo at the resolved base; it fails against the current branch that only `mkdirSync`s the stage dir.
- [ ] A test asserts `getExternalWorktreePath` for that request returns the same on-disk directory the callback is invoked in; it fails if the advertised path diverges from the materialized cwd.
- [ ] A test asserts a git-less run with no read-context request preserves today's `mkdirSync`-only stage behavior (no checkout); it fails against a design that forces a checkout unconditionally.
- [ ] `bun run typecheck`, `bun run test:v2`, `bun run test:integration:v2`, and `bun run test:shared` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md` — record that the git-less external-worktree stage can materialize a read-only target-repo checkout at the stage path, read as the agent cwd.
- `v2/docs/workflow-runner.md` — external read-context worktree materialization and its cwd semantics.

## Prerequisites
