# Materialize a readable checkout on the git-less external-worktree branch

## Problem

`withExternalWorktree` on the `git === false && localPath` branch only `mkdirSync`s the external stage dir (`v2/src/execution/external-worktree.ts:93-100`); it never checks out the target repo. A caller that needs the draft agent to read committed target-repo code at the resolved base gets a scratch directory holding only seeded input, not a repo. `getExternalWorktreePath` returns `localPath` unchanged for this branch (`external-worktree.ts:70`), so the advertised cwd is a bare stage dir with no repo on disk.

This is a standalone, fixture-driven capability with no current wiring: no production caller sets `git: false` + `localPath` expecting a checkout, and existing callers rely on the empty-stage path. The problem framing is prospective and the criteria below are necessarily fixture-driven.

## Decisions

- Materialization is opt-in via a new `ExternalWorktreeInput` field the caller sets alongside `git: false` + `localPath`; absent/false preserves today's `mkdirSync`-only behavior. Rules out forcing a checkout on every `git: false` run (which would break the test callers that rely on the empty-stage path).
- The read checkout materializes into the caller's `localPath` itself, so the advertised path and the callback cwd are the same on-disk directory. Rules out advertising an unmaterialized path while the checkout lives elsewhere.
- Materialization uses `git archive <baseRef> | tar -x` (or equivalent worktree-content extraction) into `localPath`, yielding a `.git`-less content tree at the resolved base. Rules out `git worktree add`, which would register the checkout in `git worktree list` — the exact registration this lock-free git-less branch exists to avoid. The materialized tree therefore has no `.git`/HEAD; tests assert "at the resolved base" by blob content comparison against the fixture, not HEAD interrogation.
- "Readable" names the guarantee this surface builds and tests: a readable checkout of target-repo content at cwd. It does not build or verify write-isolation, detachment, or non-propagation to the target repo; the extracted tree is a disposable copy with no link back to the source repo.
- `getExternalWorktreePath` still returns `localPath` for the git-less branch, unchanged; it already coincides with the materialized dir. Deferred to first consumer: whether the checkout is a full working tree vs. a sparse/shallow subset — pin when a caller needs it; this surface materializes a full readable content tree.
- Persistence of any drafted tree stays the caller's concern; this surface only guarantees a readable content checkout at cwd.

## Tasks

- [ ] Add an opt-in read-context field to `ExternalWorktreeInput` in `v2/src/execution/external-worktree.ts`.
- [ ] On the `git === false && localPath` branch, when the field is set, materialize target-repo content from `projectRoot` at `baseRef` into `localPath` via `git archive`/`tar` extraction before invoking the callback; leave the `mkdirSync`-only path when it is absent.
- [ ] Cover the new branch and the unchanged default in `v2/src/execution/external-worktree.test.ts` against a real git fixture.

## Acceptance criteria

- [ ] A test in `v2/src/execution/external-worktree.test.ts` drives the git-less external-worktree branch with a read-context request against a real git fixture and asserts the callback cwd exists, equals `getExternalWorktreePath` for that request, and holds target-repo content matching the fixture blobs at the resolved base; it fails against the pre-fix branch that only `mkdirSync`s the stage dir.
- [ ] A test asserts a git-less run with no read-context request preserves today's `mkdirSync`-only stage behavior (no checkout); it fails against a design that forces a checkout unconditionally.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.
- [ ] `bun run test:shared` passes.

## Documentation updates

- [ ] `v2/docs/v1-behaviors.md` — record that the git-less external-worktree stage can opt into materializing a readable target-repo content checkout at the stage path, read as the agent cwd.
- [ ] `v2/docs/workflow-runner.md` — external read-context worktree materialization and its cwd semantics.
