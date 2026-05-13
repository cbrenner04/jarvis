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
- [ ] Biome check passes (`bun run check`).

## Documentation updates

- None required (internal refactor).

## Blocker

`bun run check` cannot pass without modifying files outside this
subspec's scope. The decomposition of `runCommand` itself produces a
`run.ts` that passes biome cleanly (`bunx biome check
src/modes/patch/run.ts` reports no errors). However, `bun run check`
runs against the whole repo and surfaces 14 pre-existing biome errors
in files landed by earlier subspecs (02, 06, etc.):

- `src/agents/spawn.ts` — formatter
- `src/config.ts` — formatter and `assist/source/organizeImports`
- `src/modes/patch/completion.ts` — formatter
- `src/modes/patch/subspec.ts` — formatter, `noUnusedImports`,
  `useIndexOf`
- `src/worktree-lock.ts` — formatter, `useTemplate` (×2)
- `src/worktree.ts` — formatter, `noUnusedImports`
- `test/agents/quota.test.ts` — formatter
- `test/config.test.ts` — `noUnusedVariables`, `useLiteralKeys`
- `test/modes/patch/blocker.test.ts` — formatter
- `test/modes/patch/spec.test.ts` — formatter
- `test/modes/patch/subspec.test.ts` — formatter
- `test/run.test.ts` — formatter, `useTemplate`
- `test/worktree-lock.test.ts` — formatter, `organizeImports`,
  `noUnusedImports`, `useTemplate` (×2), `noUnusedVariables`

These are the same errors visible on the parent commit (before this
subspec's changes — main shows 16 errors; this refactor reduced two).
Patch-mode rule "Modify only files named by spec" forbids touching the
above files in this iteration; this subspec only authorizes work on
`src/modes/patch/run.ts`. Either:

1. Land a follow-up subspec that authorizes a repo-wide
   `bun run format` + biome auto-fix pass, or
2. Loosen this acceptance criterion to "biome check passes for
   `src/modes/patch/run.ts`".

Stopping here per patch-mode rules.
