# Fence ready-gate repair commits

Ready-gate repair currently re-commits every worktree change, so a repair agent can publish unrelated
test or policy edits.

## Decisions

- Snapshot allowed paths before each repair invocation from `<baseRef>...HEAD` plus the run's spec
  tree — rules out a repair-created path authorizing itself.
- A directory `specPath` and an `index.md` parent allow descendants; another file `specPath` allows
  only that file — rules out a root-level standalone spec allowing the whole repository.
- Reject an out-of-scope candidate before the repair completion commit and republish, using
  `completion_commit_failed` with the first offending repository-relative path — rules out publishing
  the violation for later operator review.
- Keep the same fence authoritative on retry/resume after rejection — rules out the generic
  completion retry sweeping the still-dirty offending path into a later commit.
- Apply the fence only to ready-gate repair re-commits — rules out changing primary completion,
  mutation-repair, or bounded repair-loop behavior.

## Work

- Derive the repair allowset from the committed run diff and resolved spec-tree scope before invoking
  each ready-gate repair.
- Validate every path the repair completion snapshot would stage before committing it; stop on the
  first path outside the allowset and prevent later completion retry from committing the violation.
- Add focused `v2/src/execution/write-loop.test.ts` coverage for rejected untouched-file edits and
  accepted run-diff/spec-tree edits.
- Update `v2/docs/write-behavior.md` and the `v2/docs/v1-behaviors.md` parity catalog.

## Acceptance criteria

- [ ] `v2/src/execution/write-loop.test.ts` test
      `rejects ready-gate repairs outside the run diff and spec tree` edits a previously untouched
      file, returns `completion_commit_failed` before repair republish, names that path, and fails
      against the unfenced baseline.
- [ ] Retrying or resuming the rejected repair cannot commit or publish its offending path.
- [ ] `v2/src/execution/write-loop.test.ts` proves repairs limited to an existing run-diff path or the
      resolved spec tree complete the existing bounded repair loop; existing ready-gate repair tests
      stay green.
- [ ] Inverting the allowed-path guard turns the untouched-file regression red; removing either
      allowset member turns its positive case red.
- [ ] `v2/docs/write-behavior.md` documents the allowset, pre-commit failure boundary, retry fence,
      path evidence, and unchanged in-scope repair loop; `v2/docs/v1-behaviors.md` records the v2
      behavior.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` exit zero.

## Documentation updates

- `v2/docs/write-behavior.md` — authoritative ready-gate repair fence and failure semantics.
- `v2/docs/v1-behaviors.md` — v2 parity-baseline entry linking the behavior to its durable contract.
