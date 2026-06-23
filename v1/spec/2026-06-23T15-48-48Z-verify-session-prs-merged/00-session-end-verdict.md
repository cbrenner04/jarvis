# Session-end verdict in no-arg triage

## Behavior

No-argument `jarvis1 triage` ends with one session-end verdict over the current Jarvis-managed worktrees: either every worktree has landed, or a named list of the worktrees that still need action. Each outstanding entry names its worktree and its PR state, distinguishing draft from ready. The verdict is appended after the existing summary table; reporting only — triage never merges, retries a merge, or intercepts external `gh pr merge` calls.

## Decisions

- Append the verdict to the existing no-arg listing rather than replace the table — keeps current summary tests green and the change additive; rules out a rewrite of the table output.
- A worktree is landed only when its PR is MERGED and its tree is clean with no unpushed commits — rules out calling a merged-but-dirty or merged-but-unpushed worktree done, the failed-merge-mistaken-for-complete case the intent guards against.
- Draft-vs-ready is reported from the existing `state`/`isDraft` PR fields (DRAFT vs OPEN) — rules out a second gh call when triage already fetches state.
- Outstanding-state derivation reuses the existing dirty/unpushed/PR-state helpers — rules out a parallel detection path that could disagree with the table rows.

## Task checklist

- Extend `triageListWorktrees` (`v1/src/commands/triage.ts`) to classify each worktree as landed vs outstanding using existing dirty/unpushed/PR-state signals.
- Emit a single verdict after the table: all-landed line, or a header plus one named line per outstanding worktree with its PR state and draft/ready.
- Add tests to `v1/test/triage-command.test.ts` covering all-landed, mixed, and all-outstanding sweeps.
- Update `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [ ] No-arg `jarvis1 triage` with every worktree MERGED, clean, and fully pushed prints a single verdict stating all work landed.
- [ ] No-arg `jarvis1 triage` with at least one non-landed worktree prints a verdict listing each outstanding worktree by name; no landed worktree appears in the outstanding list.
- [ ] A MERGED worktree with a dirty tree or unpushed commits is reported as outstanding, not landed.
- [ ] Each outstanding entry reports its PR state and distinguishes a draft PR from a ready (OPEN) PR.
- [ ] The verdict is additive: the existing `NAME ... DIRTY ... PR ... SPEC` summary table still prints, and pre-existing `v1/test/triage-command.test.ts` no-arg listing tests stay green.
- [ ] No-arg triage performs no merge and issues no `gh pr merge`.
- [ ] `v2/docs/v1-behaviors.md` describes the no-arg triage session-end verdict and the landed-vs-outstanding classification.

## Documentation updates

- `v2/docs/v1-behaviors.md` — no-arg triage session-end verdict, landed-vs-outstanding rule, draft-vs-ready reporting.
