# 00 - Skip spec archive while implementation is in flight

## Problem

Default `jarvis1 cleanup` removes a merged worktree, then archives the linked spec
to `completed/` whenever the source directory exists. After a plan PR merges while
implementation is still running, that archives the live spec path on `main` and
creates modify/delete conflicts for the patch branch still editing it.

## Behavior

After a merged worktree is removed, attempt spec archival only when all three
preconditions hold for the resolved implementation slug (`specNameForBranch` on
the archive target — `plan/<name>` → `<name>`):

1. **Spec complete** — resolved `index.md` (plus linked subspecs when index-routed)
   has every non-human-only acceptance criterion checked, same semantics as triage
   `isSpecComplete`.
2. **No open implementation PR** — `findMatchingOpenPrs(<implSlug>)` returns no
   open PR (draft or ready).
3. **No other live patch worktree** — no `.worktree/<implSlug>/` directory besides
   the worktree just removed in this cleanup pass.

When any precondition fails, leave the spec directory in place, log a skip line to
stdout naming the slug and failing guard, continue other eligible worktrees, and
do not treat the skip as a command failure (exit `0` unless another archive step
fails for a different reason). `--abandon` unchanged (never archives).

## Decisions

- Gate archival on spec completion plus implementation ownership, not on "a merged PR touched this spec dir" — rules out archiving solely because the cleaned worktree's PR merged.
- Implementation slug = `specNameForBranch` on the archive target (`plan/<name>` → `<name>`), not the timestamped directory basename — rules out matching `.worktree/plan-<name>/` against patch worktree names.
- Live patch-worktree blocker excludes the worktree removed in the current item — rules out blocking archival of a merged implementation branch because its own worktree still exists mid-pass.
- Open-PR blocker uses `findMatchingOpenPrs(<implSlug>)` with any open PR — rules out archiving while a draft or ready implementation PR still exists.
- Spec-complete gate reuses triage non-human-only linked-subspec completion semantics on the resolved `index.md` in the project root — rules out reading completion from the removed worktree copy.
- Merged worktree removal still runs when archival is skipped — rules out leaving merged plan worktrees behind while implementation is in flight.
- Skip reason logged to stdout (same channel as other cleanup skip lines) — rules out silent non-archival.
- Guard runs on both `commit:true` git-archive and `commit:false` external rename — rules out in-repo-only enforcement.
- `--abandon` bypasses archival guards — rules out coupling abandon eligibility to completion.
- Deferred to first consumer: exact skip-message tokenization beyond `<slug>` + guard label — pin when a caller needs stable log parsing.

## Tasks

- [ ] Add archival precondition helper(s) in `cleanup.ts` (completion, open impl PR, other patch worktree).
- [ ] Invoke guard after merged worktree removal, before `archiveResolvedSpec` / external rename.
- [ ] Tests in `cleanup-command.sandbox-unrunnable.test.ts`: plan-merge + in-flight patch worktree skips archive; plan-merge + open impl draft PR skips; incomplete index skips; all-clear archives; queue continues after skip; `commit:false` obeys same guard.
- [ ] Update existing archive tests' fixture specs where needed so completion preconditions are satisfied.
- [ ] `v1/docs/operator-runbook.md` — end-of-session cleanup: document the guard; drop any manual "don't cleanup right after plan merge" workaround.
- [ ] `v2/docs/v1-behaviors.md` — extend `cleanup` entry with archival preconditions.

## Acceptance criteria

- [ ] After removing a merged `plan/<name>` worktree, when `.worktree/<name>/` still exists, the spec directory stays in place and stdout logs a skip naming `<name>` and the in-flight worktree guard.
- [ ] After removing a merged `plan/<name>` worktree, when an open PR exists on branch `<name>`, the spec directory stays in place and stdout logs a skip naming the open-PR guard.
- [ ] After removing a merged worktree, when the resolved `index.md` still has an unchecked non-human-only acceptance criterion (in the index or a linked subspec), the spec directory stays in place and stdout logs a skip naming the incomplete-spec guard.
- [ ] After removing a merged worktree, when all three preconditions pass, archival behaves as today (in-repo move + commit/push; external rename + ready-intent prune).
- [ ] A skipped archive for one worktree does not block cleanup of other eligible merged worktrees in the same invocation.
- [ ] Under `commit:false`, the same three guards run before external rename to `completed/`.
- [ ] `jarvis1 cleanup --abandon` behavior is unchanged (`cleanup-command.sandbox-unrunnable.test.ts` abandon tests stay green).
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v1/docs/operator-runbook.md` — end-of-session cleanup: archival waits for spec completion and no in-flight implementation PR/worktree; safe to run `jarvis1 cleanup` after a merged plan PR while implementation continues.
- `v2/docs/v1-behaviors.md` — `cleanup` command surface: archival preconditions (spec complete, no open impl PR, no other patch worktree).
