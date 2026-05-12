# 00 - Translate ENOENT in gh spawn

## Problem

`src/gh.ts`'s `runGhCommand` registers an `'error'` handler on the spawned
`gh` process and stringifies the error into `stderr`, then returns
`exitCode: -1`. When `gh` is not on `PATH`, the underlying error is
`Error: spawn gh ENOENT` (Node) or `posix_spawn 'gh'` (Bun). The
stringification preserves "ENOENT" but the resulting message is not
actionable, and callers like `getBaseBranch()` wrap it further into
phrases like `failed to detect base branch: Error: ENOENT ...`.

Ordering note: this subspec is independent of subspec 01 (project-root
validation) at the file level — they touch disjoint files — but the two
together close the diagnostic gap. If 00 lands without 01, a missing
project root will incorrectly read as "gh: binary not found on PATH"
because the spawn ENOENT (caused by the missing `cwd`) will be
translated by the new wording. Land 01 in the same PR, or land them in
either order but close together.

## Decisions

- In the `child.on("error", ...)` handler, inspect `err.code`. When it
  equals `"ENOENT"`, populate `stderr` with the fixed message
  `gh: binary not found on PATH. Install with 'brew install gh' or ensure its directory is on PATH for this shell.`
  For all other error codes, keep the current `String(err)` behavior.
- Continue to resolve with `exitCode: -1` in both branches; the shape of
  `runGhCommand`'s return value does not change.
- No changes to call sites. Existing call sites already surface `stderr`
  content in their error messages, so they pick up the new wording for
  free.

## Task Checklist

- [ ] Update the `'error'` handler in `src/gh.ts`'s `runGhCommand` to
  branch on `err.code === "ENOENT"`.
- [ ] Write the dedicated message into `stderr` for the `ENOENT` branch.
- [ ] Preserve `String(err)` behavior for all other error codes.
- [ ] Unit tests in `src/gh.test.ts` (create if absent) covering:
  - A spawn against a guaranteed-missing binary (or a mocked
    `child_process.spawn` that emits an `ENOENT` error) produces the
    new wording in the resolved `stderr`.
  - A non-`ENOENT` spawn error still surfaces `String(err)`
    (regression guard).
- [ ] If `assertGhReady` tests exist, update any that assert on exact
  message wording to match the new text.

## Acceptance criteria

- [x] `runGhCommand`'s `ENOENT` branch produces a `stderr` string
  containing `gh: binary not found on PATH`.
- [x] Non-`ENOENT` spawn errors continue to surface `String(err)` in
  `stderr`.
- [x] `runGhCommand`'s return shape (`stdout`, `stderr`, `exitCode`)
  is unchanged.
- [x] `assertGhReady` continues to throw on failure; when the underlying
  cause is `ENOENT`, the thrown message reflects the new wording (since
  `assertGhReady` consumes `stderr`).
- [x] `bun run typecheck`, `bun test`, and `bun run check` all pass.

## Documentation updates

- No user-facing docs change in this subspec. The user-facing description
  of preflight behavior lands with subspec 01.
