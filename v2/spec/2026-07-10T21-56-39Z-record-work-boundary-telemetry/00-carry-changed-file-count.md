# Carry changed-file count from the harness completion commit

## Problem

`CompletionCommitResult` (`v2/src/execution/completion-commit.ts`) returns only
`commitSha`. Work-boundary telemetry needs the count of files the completion
commit changed, sourced as a harness git fact — not from agent output or
observability logs. Extend the completion-commit result to carry that count,
computed by the harness from the completion commit's own trees.

## Decisions

- Result carries `filesChanged: number` alongside `commitSha` — rules out a separate side-channel the boundary layer would have to re-derive.
- Count computed from the commit's own trees (base-tree `baseHead^{tree}` vs completion-tree `tree`) — rules out parsing agent output or rereading observability logs.
- Emit the count only on the paths that produce a `commitSha`; no-commit paths (missing `.git`, empty tree diff) return neither — rules out a `filesChanged: 0` row for boundaries with no real work.
- Compute from the pending commit's recorded `baseHead`/`tree` so the count is identical on the first publish and on a resume/retry republish of the same pending commit — rules out recomputing against a moved worktree HEAD.
- Count is a plain name-only tree diff with rename detection off (no `-M`) — rules out a nondeterministic count where a rename reads as 1 or 2 files depending on git defaults.

## Task checklist

- Add `filesChanged` to `CompletionCommitResult`.
- Compute the count via `runGit` name-only tree diff of `baseHead^{tree}` vs `tree` (e.g. `diff-tree --no-renames --name-only`), counting the changed paths, at each return that carries a `commitSha`.
- Return it on the fresh-commit path, the already-committed retry path, and the resumed-pending path; return `{}` unchanged on the no-commit paths.
- Add a unit test for the committer (inject `runGit`) asserting `filesChanged` matches the tree diff and is absent when no commit is produced.

## Acceptance criteria

- [ ] `CompletionCommitResult.filesChanged` is present on every result that carries a `commitSha`, and its value equals the number of files differing between the completion commit's base tree and completion tree.
- [ ] `filesChanged` is computed by the committer from the commit's own trees via the injected git runner using a name-only diff with rename detection off (no `-M`) — not from agent output or observability logs.
- [ ] No-commit paths (missing `.git`, base tree equal to completion tree) return a result with neither `commitSha` nor `filesChanged`.
- [ ] Republishing the same pending completion commit (resume/retry path) yields the same `filesChanged` value as the first publish.
- [ ] A new committer unit test asserts the count against a known tree diff and its absence on the no-commit path.

## Documentation updates

- None. Internal v2 result shape; `telemetry-capture.md` is updated by subspec 01 when the field reaches its consumer.
