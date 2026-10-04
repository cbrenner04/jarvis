# 00 — Refresh re-derives PR title

## Problem

`refreshPrBody` (`v2/src/execution/pr-body-refresh.ts`) rewrites only the body; the title set at `gh pr create` via `resolvePublicationTitle` (`v2/src/execution/spec-creation-title.ts`) goes stale when the plan's `index.md` heading changes (issue #3934).

## Decisions

- Refresh resolves the title with `resolvePublicationTitle` (same explicit-title precedence) rather than a new resolver — creation and refresh must agree.
- Refresh fetches the current title and runs `gh pr edit <branch> --title <new>` only when it differs, not unconditionally — avoids a no-op network write every refresh.
- Title fetch/write are injectable seams alongside `fetchPrBody`/`writePrBody`, so tests use fakes rather than a real `gh`.
- `RefreshPrBodyInput` gains an optional explicit title and a raw (unformatted) spec path; `completion-publisher.ts` threads `input.creationTitle` and `input.specPath` straight through — not the already-resolved creation title, and not the display-formatted `specPath` it builds for the body header via `formatPublicationSpecPathForPrBody` — so an unset explicit title re-reads the live `index.md` heading on refresh, and title resolution still works for specs in an external target repo where the formatted display path is just a basename.
- Refresh overwrites a hand-edited PR title whenever it differs from the resolved title; it does not detect or preserve manual title edits.
- A failed title fetch or edit logs a warning and does not fail the refresh — the title is cosmetic, unlike the body.

## Acceptance criteria

- [x] A new test in `v2/src/execution/pr-body-refresh.test.ts` asserts refresh issues a title edit with the new title when the resolved title differs from the current PR title, and issues none when equal; it fails against the pre-fix code.
- [x] A test asserts an explicit title overrides the `index.md` heading during refresh, and fails against the pre-fix code.
- [x] A test in `v2/src/execution/completion-publisher.test.ts` asserts the publisher wires the title fetch/write seams and `input.creationTitle`/`input.specPath` into `refreshPrBody`, and that a title edit occurs when the resolved title differs from the current PR title; it fails against the pre-fix code.
- [x] A test asserts the default title-write seam invokes `gh pr edit <branch> --title <new>`.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` § Commit trailers and PR attribution — body refresh also re-derives the title and edits it when changed.
- `v2/docs/v1-behaviors.md` — record that PR titles now track the spec heading on refresh, and that refresh overwrites a hand-edited title rather than preserving it.
