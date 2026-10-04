# Fence ready-gate repair commits

Ready-gate repair must not turn an unfenced dirty worktree into a completion commit.

## Decisions

- Before the first repair invocation, derive and freeze the allowset from committed
  `<baseRef>...HEAD` paths plus the resolved spec scope. A directory spec scope, and the parent of
  an `index.md`, allows descendants; a standalone spec file allows only itself.
- The candidate set exactly matches paths a repair completion commit would stage: additions,
  deletions, type changes, tracked ignored changes, submodules, and both source and destination of
  a rename. It excludes Git metadata and every path that completion staging would not include.
- Read candidate paths with NUL-delimited Git output. Normalize to repository-relative paths without
  lossy filename decoding or repository escape; byte-sort normalized paths, then report the first
  out-of-scope path with a deterministic escaped rendering.
- Reject that candidate before its completion commit or republish as `completion_commit_failed`.
  The fence applies only to ready-gate repair re-commits, not primary completion, mutation repair,
  or the bounded repair loop itself.

## Work

- Derive the frozen allowset and validate the exact repair-completion candidate set before commit.
- Add focused `v2/src/execution/write-loop.test.ts` coverage for the rejection, candidate-path
  contract, deterministic evidence, and both allowed-path members.
- Document the normal ready-gate repair fence.

## Acceptance criteria

- [x] `v2/src/execution/write-loop.test.ts` test `rejects ready-gate repairs outside the run diff
      and spec tree` edits a previously untouched file, returns `completion_commit_failed` before
      repair republish, names that path, and fails against the unfenced baseline.
- [x] Representative `write-loop.test.ts` regressions prove the candidate set includes additions,
      deletions, type changes, tracked ignored changes, submodules, and both rename sides; excludes
      paths completion would not stage; and handles unusual filenames through NUL-safe path handling.
- [x] The same regressions prove first-offender evidence is stable by normalized repository-relative
      byte ordering, including when Git reports candidates in another order.
- [x] Distinct `write-loop.test.ts` positive cases prove a repair limited to an existing run-diff
      path and a repair limited to the resolved spec tree each complete the bounded repair loop;
      existing ready-gate repair coverage stays green.
- [x] Inverting the fence makes the untouched-file regression red; removing the run-diff or
      spec-tree allowset membership independently makes its corresponding positive case red.
- [x] `v2/docs/write-behavior.md` documents the frozen allowset, exact candidate-path contract,
      deterministic path evidence, pre-commit failure boundary, and unchanged in-scope repair loop.

## Documentation updates

- `v2/docs/write-behavior.md` — normal ready-gate repair fence and failure semantics.
