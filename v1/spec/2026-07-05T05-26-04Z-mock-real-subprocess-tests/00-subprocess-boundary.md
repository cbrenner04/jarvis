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

- [ ] Add `shared/subprocess.ts`.
- [ ] Route `shared/git.ts` exports through injectable runner.

## Acceptance criteria

- [ ] `branchExistsLocal`, `branchExistsOnOrigin`, `getCurrentBranch` each
      accept optional `SubprocessRunner` from `shared/subprocess.ts`.
- [ ] `shared/git.ts` no longer imports `execFileSync` or `node:child_process`.
- [ ] Existing `v1/src/` and `v2/src/` call sites typecheck and run unmodified
      against default runner — no required call-site edits.

## Documentation updates

- None.
