# External worktree drops invert-for-test hooks

`external-worktree.ts` exports `setInvertExternalWorktreeLockReleaseForTest` and a module variable so
guard-inversion tests pass without mutating the real lock-release `finally` guard.

## Decisions

- Strip all four forbidden hook shapes from `external-worktree.ts` — always release lock in
  `finally`.
- Lock-release guard evidence lives in CLI `workflow.test.ts` (prerequisite) — no execution-owned
  invert test or manual AC here.

## Tasks

- **external-worktree.ts:** remove `invertExternalWorktreeLockReleaseForTest` and
  `setInvertExternalWorktreeLockReleaseForTest`; always release lock in `finally`.
- Run `bun run typecheck` and `bun test v2/src/execution/external-worktree.test.ts`.

## Acceptance criteria

- [x] `external-worktree.ts` carries no `setInvert*ForTest` export, `invert*ForTest` module
  variable, `invert*` function parameter, or `invert*ForTest` type member.

## Documentation updates

- None — `write-step-rules-forbid-production-invert-hooks` owns operator-facing guard-inversion doc.
