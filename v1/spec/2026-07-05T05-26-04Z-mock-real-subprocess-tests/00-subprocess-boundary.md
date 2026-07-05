# Subprocess boundary module and shared/git.ts

## Problem

`shared/git.ts` calls `execFileSync` directly. No seam exists to inject canned
stdout/exit-code in tests.

## Decisions

- `shared/subprocess.ts`: injectable `SubprocessRunner` (cmd, args, cwd →
  stdout string; synchronous; throws on non-zero exit) plus
  `realSubprocessRunner` backed by `execFileSync`.
- Bespoke interface over `typeof execFileSync` injection — narrows the seam to
  what git/gh call sites need.
- Optional runner param defaulting to `realSubprocessRunner` on
  `branchExistsLocal`, `branchExistsOnOrigin`, `getCurrentBranch` — same DI
  shape as `DescendantTracker` in `reap.ts`.
- No behavior change for existing callers at default runner.
- Deferred to first consumer: thrown-error shape (plain `Error` vs
  execFileSync-mimicking object).

## Task checklist

- [x] Add `shared/subprocess.ts`.
- [x] Route `shared/git.ts` exports through injectable runner.

## Acceptance criteria

- [x] `branchExistsLocal`, `branchExistsOnOrigin`, `getCurrentBranch` each
      accept optional `SubprocessRunner` from `shared/subprocess.ts`.
- [x] `shared/git.ts` no longer imports `execFileSync` or `node:child_process`.
- [x] Existing `v1/src/` and `v2/src/` call sites typecheck and run unmodified
      against default runner — no required call-site edits.

## Documentation updates

- None.
