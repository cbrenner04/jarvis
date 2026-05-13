# 11 — Decompose runCommand

## Problem

`src/modes/patch/run.ts` `runCommand` is ~1100 lines, single linear
function with eight bailout points. Each preceding subspec in this group
adds another bailout (timeout, lock acquired, blocker, weak quota,
telemetry write). The function is already hard to read; with this work
landed it is harder.

Risk of refactoring earlier: every behavior-change subspec already needs
to edit `runCommand`. Refactoring first forces each one to rebase across
a moved function. Refactoring last consumes the test surface those
changes built, which is the right time.

## Behavior

This subspec is a pure refactor. No behavior change. No new tests. All
existing tests must pass unchanged. Each extracted function lives in the
same file (`src/modes/patch/run.ts`) unless extraction to a sibling file
is clearly correct (e.g. a phase that has no `runCommand` state).

Target seams (subject to revision during implementation; the acceptance
criteria are about decomposition, not specific shapes):

1. `resolveAndPreflight(opts) → { project, cfg, agentWorkingDir, ... }`
   — handles project resolution, root preflight, cwd/git checks, lazy
   origin backfill, gh readiness, worktree setup, symlinks.
2. `setupLogging(opts, project, runNamespace) → { fanout, writeSessionLine,
   sessionFd, logClient }` — log client, session fd, fanout helper.
3. `runIteration({ ctx, iteration }) → IterationOutcome` — one body of
   the while-loop. Returns a discriminated union the outer loop dispatches
   on (`continue`, `return-success`, `return-error`, etc.).
4. `finalize(ctx, outcome) → exitCode` — printBoundedTail, drain logs,
   close fd, restore signal handlers.

`runCommand` becomes the composition of these phases plus the
while-loop driver. Target length: under 150 lines.

Helpers that are pure (`diffAcceptanceCriteria`, `hasUpstream`,
`getCurrentBranch`, `getIndexTitle`, regex parsers — note: subspec 06
removes most of the regexes) move out of `runCommand`'s body unchanged.

## Tasks

- [ ] Extract `resolveAndPreflight`.
- [ ] Extract `setupLogging`.
- [ ] Extract `runIteration` returning a discriminated outcome.
- [ ] Extract `finalize`.
- [ ] Reduce `runCommand` body to phase composition + driver loop.
- [ ] No new tests; all existing tests pass unchanged.

## Acceptance criteria

- [x] `runCommand` is under 150 lines (excluding imports, types).
- [x] No public exported behavior or signature changes; all callers
      (`cli.ts`, tests) compile and run unchanged.
- [x] All existing tests pass (`bun test`).
- [x] `bun run typecheck` passes.
- [x] Biome check passes (`bun run check`).

## Documentation updates

- None required (internal refactor).
