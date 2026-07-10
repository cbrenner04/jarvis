# Commit completed-run worktree changes

The v2 write loop durably records successful completion but leaves the external
worktree dirty. Add the runner-owned git boundary that makes completed work
addressable by commit SHA.

## Decisions

- Commit only `complete` outcomes after `commitCompletionBoundary` returns — rules out commits for progress, pause, blocked, contract-miss, invocation-failure, or pre-transaction mutation.
- Stage the whole external worktree with `git add -A`; a clean index succeeds without a commit — rules out tracked-only staging, empty commits, or clean-tree failure.
- Use subject `jarvis: complete run`, first body line `Spec: <WriteLoopInput.specPath>`, and trailer `Jarvis-Agent: <final binding metadata.agent>` — rules out reading spec prose for identity, using the model/binding ID, or an attribution-invisible body.
- Put git execution behind the shared injectable subprocess runner at the write-loop runner boundary — rules out subprocess calls in `commitCompletionBoundary`, the state-store API, or the host-agnostic step executor.
- Operate directly in the existing v2 external worktree — rules out porting v1 `.worktree/`, lock-exclusion, symlink, push, or PR behavior.
- Surface staging or commit failure after durable completion and leave the worktree recoverable — rules out reporting successful completion without a git boundary or rolling back SQLite state after it committed.

## Work

- Add the injectable completion-commit operation and call it after successful durable completion.
- Cover dirty, clean, attribution/message, ordering, non-complete, and git-failure cases.
- Update the durable write lifecycle and v1 behavior parity catalog.

## Acceptance criteria

- [ ] A dirty external worktree that reaches `complete` is staged and committed only after its terminal SQLite completion boundary is durable.
- [ ] The completion commit has subject `jarvis: complete run`, first body line `Spec: <input specPath>`, and `Jarvis-Agent: <final binding metadata.agent>` trailer.
- [ ] A clean completed worktree returns success without creating an empty commit.
- [ ] Progress, pause, budget exhaustion, blocked, contract miss, and invocation failure do not create completion commits.
- [ ] A staging or commit error rejects the run after the durable completion boundary and preserves the external worktree changes for recovery.
- [ ] Git subprocess execution is injectable; the state-store API, `commitCompletionBoundary`, and host-agnostic step execution gain no git side effects.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.
- [ ] `v2/docs/write-behavior.md` documents the completed-run commit boundary, clean no-op, failure semantics, attribution source/message, and external-worktree ownership.
- [ ] `v2/docs/v1-behaviors.md` marks the completed-run commit and trailer behavior as ported while retaining the v2 external-worktree differences.

## Documentation updates

- Update `v2/docs/write-behavior.md`.
- Update `v2/docs/v1-behaviors.md`.
