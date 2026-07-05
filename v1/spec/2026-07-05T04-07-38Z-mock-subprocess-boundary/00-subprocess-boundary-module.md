# Subprocess boundary module and shared/git.ts conversion

## Problem

`shared/git.ts` calls `execFileSync` directly against the real `git` binary.
No seam exists to intercept argv or inject canned stdout/exit-code, so every
test touching it must spawn real `git` (`shared/git.sandbox-unrunnable.test.ts`).

## Decisions

- New module `shared/subprocess.ts` exports an injectable `SubprocessRunner`
  interface (one method covering the execFileSync-style call shape used by
  `shared/git.ts`: cmd, args, cwd, returns stdout as a string, throws on
  non-zero exit, call is synchronous — matches today's `execFileSync`
  behavior) plus a `realSubprocessRunner` default backed by
  `node:child_process.execFileSync` — rules out each call site rolling its own
  ad hoc mock shape.
- Bespoke `SubprocessRunner` interface chosen over the repo's existing
  `typeof execFileSync` injection convention (`ci-checks.ts`,
  `commands/triage.ts`) — narrows the seam to the cmd/args/cwd/stdout shape
  this boundary (and future `gh` call sites) actually need, rather than
  leaking `execFileSync`'s full options/overload surface.
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
- Deferred to first consumer: thrown-error shape (plain `Error` vs. an
  `execFileSync`-mimicking object) — pin when a `gh`-parsing call site needs it.

## Task checklist

- [x] Add `shared/subprocess.ts` with the `SubprocessRunner` interface and
      `realSubprocessRunner`.
- [x] Convert `shared/git.ts`'s three exported functions to route through an
      injectable runner, defaulting to `realSubprocessRunner`.

## Acceptance criteria

- [x] `shared/git.sandbox-unrunnable.test.ts` stays green (behavior unchanged
      by the boundary introduction).
- [x] `branchExistsLocal`, `branchExistsOnOrigin`, and `getCurrentBranch` each
      accept an optional `SubprocessRunner` parameter from `shared/subprocess.ts`.
- [x] `shared/git.ts` no longer imports `execFileSync` or `node:child_process`
      directly.
- [x] Existing call sites of `shared/git.ts`'s exported functions (`v1/src/`,
      `v2/src/`) typecheck and run unmodified against the new default-runner
      signature — no required call-site edits.

## Documentation updates

- None: internal, behavior-preserving boundary with no operator-facing effect.
