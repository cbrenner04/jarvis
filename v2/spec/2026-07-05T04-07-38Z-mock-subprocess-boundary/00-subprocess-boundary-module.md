# Subprocess boundary module and shared/git.ts conversion

## Problem

`shared/git.ts` calls `execFileSync` directly against the real `git` binary.
No seam exists to intercept argv or inject canned stdout/exit-code, so every
test touching it must spawn real `git` (`shared/git.sandbox-unrunnable.test.ts`).

## Decisions

- New module `shared/subprocess.ts` exports an injectable `SubprocessRunner`
  interface (one method covering the execFileSync-style call shape used by
  `shared/git.ts`: cmd, args, cwd, returns stdout as a string, throws on
  non-zero exit) plus a `realSubprocessRunner` default backed by
  `node:child_process.execFileSync` — rules out each call site rolling its own
  ad hoc mock shape.
- `shared/git.ts`'s three exported functions (`branchExistsLocal`,
  `branchExistsOnOrigin`, `getCurrentBranch`) each accept an optional runner
  parameter defaulting to `realSubprocessRunner` — same DI-seam shape as
  `DescendantTracker` in `v1/src/modes/patch/reap.ts` (constructor/function
  param, defaults to real OS calls) — rules out a module-level mutable
  singleton, which would leak mock state across tests.
- No behavior change for existing callers: default runner reproduces today's
  `execFileSync` semantics (same stdio/encoding, same throw-on-failure).
- Other `execFileSync`/`spawnSync` call sites (`v1/src/pr-module.ts`,
  `v1/src/worktree.ts`, `v1/src/scoped-abandon-preflight.ts`, etc.) are out of
  scope — they convert in later intents against this same boundary.

## Task checklist

- [ ] Add `shared/subprocess.ts` with the `SubprocessRunner` interface and
      `realSubprocessRunner`.
- [ ] Convert `shared/git.ts`'s three exported functions to route through an
      injectable runner, defaulting to `realSubprocessRunner`.

## Acceptance criteria

- [ ] `shared/git.sandbox-unrunnable.test.ts` stays green (behavior unchanged
      by the boundary introduction).
- [ ] `branchExistsLocal`, `branchExistsOnOrigin`, and `getCurrentBranch` each
      accept an optional `SubprocessRunner` parameter from `shared/subprocess.ts`.

## Documentation updates

- None: internal, behavior-preserving boundary with no operator-facing effect.
