---
name: gate-allowset-derivation-handles-external-and-empty-spec-scope
---

# Ready-gate allowset derivation succeeds on external and empty spec scopes and names every failure

## Problem

`deriveGateAllowedPaths` (`v2/src/execution/ready-finalize.ts`) returns `undefined` for an external spec home (`specs: "external"`): `resolveSpecScopeRoot` succeeds on the existing out-of-worktree dir, so the `scopeRoot === null` fallback via `normalizePublicationSpecPath` is unreachable, and enumeration's `relative(worktreePath, file)` yields `../` paths that `validateRepoRelativePath` rejects (#3423, same root as #3417). An existing-but-empty scope root (`implement-review` with no verdict patch, `.jarvis-implement-review/`) hits `files.length === 0` → `null` (#4004). Its eight `undefined` returns carry no reason.

## Decisions

- An empty spec scope root derives an **empty** allowset, not "cannot derive"; rules out `files.length === 0` returning `null`.
- Spec-tree enumeration resolves paths relative to the spec scope root, not the code worktree; rules out `..`-prefixed rejects for a legitimate out-of-repo spec home.
- `resolveSpecScopeRoot` reports whether the root is inside the worktree; out-of-worktree roots take the `normalizePublicationSpecPath` path the `scopeRoot === null` fallback implements; rules out the fallback staying unreachable when the external dir exists.
- Every derivation failure returns a distinct named reason (result type, not bare `undefined`); rules out eight failure modes collapsing to one opaque string.

## Acceptance criteria

- [ ] A `ready-finalize` test proves `deriveGateAllowedPaths` returns a non-empty allowset for an absolute `specPath` directory outside the worktree; it fails against the pre-fix `..`-rejection returning `undefined`.
- [ ] A `ready-finalize` test proves derivation yields an allowset (not a failure) when the resolved scope root exists with no Markdown files; it fails against the pre-fix `files.length === 0` → `null`.
- [ ] A test proves the out-of-worktree path is taken when the external directory **exists**; it fails while `resolveSpecScopeRoot` returning a real directory bypasses the fallback.
- [ ] A test asserts each distinct derivation failure returns its own named reason.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — allowset derivation over external and empty spec scopes; named derivation-failure reasons.
- `v2/docs/v1-behaviors.md` — record external-spec-home allowset derivation.

## Prerequisites
