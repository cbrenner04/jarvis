# Session-end verdict in no-arg triage

## Behavior

No-argument `jarvis1 triage` ends with one session-end verdict over the current Jarvis-managed worktrees: either every worktree has landed, or a named list of the worktrees that still need action. Each outstanding entry names its worktree and its PR state, distinguishing draft from ready. The verdict is appended after the existing summary table; reporting only — triage never merges, retries a merge, or intercepts external `gh pr merge` calls.

## Decisions

- Append the verdict below the existing table rows; the `NAME/DIRTY/PR/SPEC` rows print unchanged — rules out a rewrite of the table output.
- The pre-existing no-arg listing test asserts a total non-empty-line count, so an appended verdict line breaks it; scope that assertion to the table rows — rules out leaving a now-false line-count test that the appended verdict trips.
- A worktree is landed only when its PR is MERGED and its tree is clean with no unpushed commits — rules out calling a merged-but-dirty or merged-but-unpushed worktree done, the failed-merge-mistaken-for-complete case the intent guards against.
- Add `isDraft` to the existing PR-state JSON query (the table path fetches `--json state` only; OPEN/CLOSED/MERGED carries no draftness) and report draft-vs-ready from it — rules out treating draft as a `state` value, which GitHub does not model.
- Make gh output injectable for tests by routing the PR-state/gate helpers in `v1/src/commands/triage.ts` through a stubbable runner seam (injected runner or PATH shim) — rules out an unbounded execSync refactor with no test seam.
- A PR-state query failure classifies the worktree as outstanding (same safe direction as no-PR) — rules out a failed merge hiding as landed; matches the intent's guard.
- Plan worktrees (`.worktree/plan-*`) have no implementation PR and classify as outstanding — rules out silently dropping an uncleaned plan tree, which is genuine unfinished business.
- Outstanding-state derivation reuses the existing dirty/unpushed/PR-state helpers — rules out a parallel detection path that could disagree with the table rows.

## Task checklist

- Add the gh-runner stub seam to the PR-state helpers in `v1/src/commands/triage.ts`, and add `isDraft` to their JSON query.
- Extend `triageListWorktrees` (`v1/src/commands/triage.ts`) to classify each worktree as landed vs outstanding using existing dirty/unpushed/PR-state signals; classify a PR-state query failure and plan worktrees as outstanding.
- Emit a single verdict after the table: all-landed line, or a header plus one named line per outstanding worktree with its PR state and draft/ready.
- Rescope the pre-existing no-arg line-count assertion in `v1/test/triage-command.test.ts` to the table rows, and add tests covering all-landed, mixed, and all-outstanding sweeps.
- Update `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [x] No-arg `jarvis1 triage` with every worktree MERGED, clean, and fully pushed prints a single verdict stating all work landed.
- [x] No-arg `jarvis1 triage` with at least one non-landed worktree prints a verdict listing each outstanding worktree by name; no landed worktree appears in the outstanding list.
- [x] A MERGED worktree with a dirty tree or unpushed commits is reported as outstanding, not landed.
- [x] Each outstanding entry reports its PR state and distinguishes a draft PR (GitHub `isDraft` true) from a ready (OPEN, non-draft) PR.
- [x] A worktree whose PR-state query fails is classified outstanding, never landed.
- [x] A plan worktree (`.worktree/plan-*`) is classified outstanding.
- [x] The verdict is additive: the existing `NAME/DIRTY/PR/SPEC` summary rows still print unchanged, with the verdict appended below; the rescoped `v1/test/triage-command.test.ts` no-arg listing test asserts the table rows and stays green.
- [x] No-arg triage performs no merge and issues no `gh pr merge`.
- [x] `v2/docs/v1-behaviors.md` describes the no-arg triage session-end verdict and the landed-vs-outstanding classification.

## Documentation updates

- `v2/docs/v1-behaviors.md` — no-arg triage session-end verdict, landed-vs-outstanding rule, draft-vs-ready reporting; note that a deleted post-merge upstream satisfies the no-unpushed check (deleted upstream = merged-and-cleaned = landed).
