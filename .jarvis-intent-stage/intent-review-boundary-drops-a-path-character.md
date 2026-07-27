---
name: intent-review-boundary-drops-a-path-character
---

# Intent review boundary check preserves full git porcelain paths

## Problem

`gitStatusPaths` (`v2/src/execution/review-intent-enforcement.ts`) applies `.trim()` to the
whole `git status --porcelain --untracked-files=all` buffer, then uses `line.slice(3)` per line.
When the first porcelain line is an unstaged tracked change (`<space>M path`), aggregate trim drops
the leading space, `slice(3)` starts one character late, and the first path character is lost.

Intent review always hits this: the split step commits the staged ready-intent, so the actuator’s
edit is a tracked `<space>M` line and porcelain lists it first. The mangled path misses
`stagingPrefix`, enforcement reports a false boundary violation, restores the tree, and the review
step stops with `invocation_failure` (`failureKind: "error"`). Workaround: `--review-passes 0`.

## Decisions

- Parse each porcelain line from the raw line, not from whole-output `.trim()` — rules out aggregate
  trim plus downstream compensation.
- Line splitting tolerates a trailing newline without an empty entry; per-line handling strips only
  trailing newline/CR, never leading whitespace — rules out per-line `trimStart`.
- Rename lines `XY old -> new` record the destination path — rules out treating the full remainder
  as one path.
- Staging-dir, verdict file, and owner-marker allowlists unchanged — rules out relaxing the boundary
  to mask the parse bug.

## Acceptance criteria

- [ ] A test drives `gitStatusPaths` (or the enforcement entry point) against porcelain whose
      **first** line is `<space>M <path>` and asserts the full path; it fails on current whole-output
      `.trim()`.
- [ ] A test covers first-line `?? <path>` plus `A  <path>` in the same output and asserts every
      path is intact.
- [ ] A test covers the rename form and asserts the destination path is recorded.
- [ ] An intent-review test where the actuator modifies a **tracked** file inside the staging
      directory completes without a boundary violation; it fails on current behavior.
- [ ] An intent-review test where a file outside the staging directory is modified still reports the
      violation with the correct, unmangled path.
- [ ] Reverting the parse fix turns the first and fourth acceptance tests RED.
- [ ] `bun run typecheck` and `bun run test:v2` are green.

## Documentation updates

- `v2/docs/operator-runbook.md` — remove the intent `--review-passes 0` workaround note once fixed;
      state that boundary violations name repo-relative paths verbatim.

## Prerequisites

