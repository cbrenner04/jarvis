# PR-body spec line never absolute

## Problem

`normalizePublicationSpecPath` (`v2/src/execution/publication-spec-path.ts`) returns the absolute path for specs outside the worktree (always for `specs: external`); `pr-body-refresh.ts` and `completion-publisher.ts` print it as the PR-body `Spec:` line, leaking local paths.

## Decisions

- In-worktree specs keep the repo-relative `Spec:` line unchanged; out-of-worktree specs render `Spec: <spec dir name>` — rules out printing a home-relative or `~`-prefixed path.
- Spec dir name: basename of the directory containing `index.md` when the spec resolves to a directory or an `index.md` file; basename of `specPath` itself when it resolves to a single non-index file (mirrors the existing fallback in `resolvePublicationTitle`, `v2/src/execution/spec-creation-title.ts`) — rules out a wrong parent-directory name for single-file specs.
- Add a PR-body-only formatter applied at the two PR-body construction sites only: `buildSpecHeader` in `pr-body-refresh.ts`, and the `specPath` value computed at `completion-publisher.ts:82` (feeds both `createDraftPr`'s `Spec:` line and `refreshPrBody`). `normalizePublicationSpecPath` itself is unchanged; `completion-commit.ts`'s independent call for the commit-body `Spec:` trailer is untouched — rules out formatting the commit trailer as a spec-dir basename.

## Acceptance criteria

- [ ] A new test in `v2/src/execution/pr-body-refresh.test.ts` builds the body for a `specs: external` run (spec dir outside the worktree) and asserts the `Spec:` line is the spec dir name with no absolute path and no home-directory prefix; it fails against the pre-fix `Spec: /…` line.
- [ ] A new test in `v2/src/execution/completion-publisher.test.ts` asserts the same for the completion-published PR body; it fails against the pre-fix code.
- [ ] A new test in `v2/src/execution/pr-body-refresh.test.ts` (or `completion-publisher.test.ts`) drives a single-file spec (no `index.md`, e.g. `spec/foo.md`) and asserts the `Spec:` line is the file's own basename, not its parent directory's name.
- [ ] A new test in `v2/src/execution/completion-commit.test.ts` asserts the commit-body `Spec:` trailer still carries the full absolute path for an external spec (unchanged by this subspec) — no existing test pins this today.
- [ ] `v2/src/execution/completion-commit.test.ts` existing tests (in-worktree `Spec:` trailer cases) stay green.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md` — note PR-body `Spec:` line renders the spec dir name for external specs.
