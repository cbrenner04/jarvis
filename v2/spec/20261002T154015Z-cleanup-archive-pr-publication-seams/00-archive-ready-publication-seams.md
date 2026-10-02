# Archive-ready push and open-or-reuse PR seams

## Problem

`pushBranch`, open-PR listing, and `findOrCreatePr` live private in `completion-publisher.ts` and always serve lane completion: draft `gh pr create`, harness body refresh, lane-history guards, and optional `leaseFromSha` force-with-lease. `jarvis cleanup` needs the same git/gh mechanics with injectable seams, a ready (non-draft) create, open-or-reuse without a second create, and no lane-only follow-on work.

## Decisions

- Export an archive-oriented entry (name at implementer discretion) on `completion-publisher.ts` that accepts `worktreePath`, `branch`, `baseRef`, caller `title`/`body`, optional `signal`, and optional partial `git`/`gh` seams — rules out wiring cleanup through `createCompletionPublisher` and its `CompletionPublisherInput`.
- Archive push reuses the shared push helper with `leaseFromSha` omitted so publication never runs lane `--force-with-lease` — rules out coupling cleanup to lane completion lease metadata.
- Shared push without lease throws `ForeignRemoteTipError` when the remote tip is not an ancestor of local HEAD, same as lane completion without lease — rules out cleanup-specific plain/force push in this slice; push conflict retry beyond that error is owned by the cleanup wiring intent.
- Archive open-or-reuse lists open PRs for `(branch, baseRef)` via the shared list helper; sole non-draft match returns its URL after `confirmPr` without `gh pr create`; sole open draft match runs `gh pr ready` then `confirmPr` and returns that URL without `gh pr create` — rules out leaving a draft as the archive outcome and rules out a second create when any sole open PR exists.
- Zero open matches runs `gh pr create` without `--draft` using caller title/body, then `confirmPr`, even when closed or merged PRs exist for the same `(branch, baseRef)` — rules out lane `findOrCreatePr` closed/merged refusal and rules out silent divergence from lane history guards.
- Ready create maps `gh pr create` “no commits between” failures to `NoPublishableCommitsError` like `createDraftPr` — rules out a divergent error surface on empty publish ranges.
- More than one open match keeps `AmbiguousOpenPrError` — rules out silent pick among multiples.
- Archive path skips `refreshPrBody`, `deriveSpecRunBodySummary`, harness ready-flip undo, and `classifyLaneHistoryHeadLineage` / closed-or-merged lane outcomes — rules out treating archive publication as lane republication.
- `createCompletionPublisher` keeps draft-first create, body refresh, lane-history guards, harness flip evidence, and `runPublicationWithRetry` wrapping unchanged; lane code calls the same extracted push/list/create/confirm helpers internally — rules out a second divergent push/PR implementation for lanes.
- `baseRef` is caller-supplied (cleanup resolves default branch before calling) — rules out default-base discovery inside this slice.
- Deferred to first consumer: whether archive push/PR steps use `runPublicationWithRetry` — pin when cleanup publication chooses retry policy.

## Task checklist

- [ ] Extract shared push, open-PR list/match, ready create, and `confirmPr` from `completion-publisher.ts`; keep lane-only logic (`resolveOpenDraftPr`, lane history, draft create) on the lane path.
- [ ] Implement the archive-oriented push + open-or-reuse orchestrator (ready create, draft reuse via `gh pr ready`, confirm on reuse and after create) with injectable `git`/`gh` seams.
- [ ] Refactor `createCompletionPublisher` to call the extracted helpers without behavior change.
- [ ] Add `completion-publisher.test.ts` coverage: ready create against `baseRef`, reuse of sole open ready PR, sole open draft promoted with `gh pr ready`, post-create `confirmPr` failure surface, and returned PR URL; pre-fix signal is missing exported archive entry (import/typecheck may fail before tests run).

## Acceptance criteria

- [ ] `completion-publisher.test.ts` archive publication tests assert one `gh pr create` without `--draft` for caller `title`/`body` against the supplied `baseRef` when no open PR exists, then `confirmPr` success and returned PR URL; fails against pre-fix code missing the exported archive entry and ready-create path (reachable on main: no archive export; pre-fix may fail typecheck before tests).
- [ ] The same tests assert sole matching open non-draft PR for `(branch, baseRef)` is reused with no `gh pr create`, `confirmPr` only, and returned PR URL; fails against pre-fix code as above.
- [ ] The same tests assert sole matching open draft PR runs `gh pr ready` once, no `gh pr create`, then returns PR URL; fails against pre-fix code as above.
- [ ] `describe("createCompletionPublisher", ...)` and `describe("createCompletionPublisher lease-forced push", ...)` in `completion-publisher.test.ts` stay green.
- [ ] `terminal-publication.test.ts` stays green.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- None — lane completion publication semantics are unchanged; cleanup operator docs land in the dependent intent.
