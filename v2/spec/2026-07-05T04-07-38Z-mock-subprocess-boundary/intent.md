---
name: mock-subprocess-boundary
---

# Introduce a mockable git/gh subprocess boundary

## Problem

`shared/git.ts` and other call sites invoke `execFileSync`/`spawnSync` directly
against real `git`/`gh` binaries, so any test exercising them either spawns a
real subprocess or must not exist. There is no seam to intercept argv and
inject canned stdout/stderr/exit-code in tests.

## Scope

- Add a mockable subprocess boundary (a thin wrapper module or injectable
  interface) that all `git`/`gh` call sites route through, replacing direct
  `execFileSync`/`spawnSync` calls in `shared/git.ts` at minimum.
- Convert `shared/git.sandbox-unrunnable.test.ts` to use the new boundary with
  mocked subprocess calls; drop its `.sandbox-unrunnable` designation once no
  real subprocess is spawned.
- Audit `shared/preload.sandbox-unrunnable.test.ts`: it asserts Bun's agent
  preload actually mutates `PATH` for a real spawned process — keep as a
  justified real-subprocess test if mocking would defeat its purpose, and
  record why.

## Out of scope

- Converting every other subprocess call site — this intent only proves the
  boundary works end-to-end on `shared/git.ts`; other files convert in later
  intents using the same boundary.

## Documentation updates

- None beyond code-level docs on the new boundary module, unless the boundary
  changes any operator-facing behavior (it shouldn't — it's test-seam only).

## Prerequisites
