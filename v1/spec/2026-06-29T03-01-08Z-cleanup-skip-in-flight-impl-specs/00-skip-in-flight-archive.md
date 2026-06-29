# 00 - Skip spec archive while implementation is in flight

## Problem

Default `jarvis1 cleanup` removes a merged worktree, then archives the linked spec
to `completed/` whenever the source directory exists. After a plan PR merges while
implementation is still running, that archives the live spec path on `main` and
creates modify/delete conflicts for the patch branch still editing it.

## Behavior

After a merged worktree is removed, attempt spec archival only when all three
preconditions hold. Guards 2 and 3 key off `specName` from
`resolveSpecArchiveSource` (timestamped directory basename when the spec dir is
timestamped — patch branches and `.worktree/` dirs use the same name via
`getSpecName`):

1. **Spec complete** — read completion from the resolved archive source directory
   on the project root: `index.md` when present (index-routed, including linked
   subspecs), else the sole spec file. Every non-human-only acceptance criterion
   must be checked via shared exported `isSpecComplete` (same semantics as triage).
   When the spec would be vacuous-complete (no non-human-only AC) and guard 2 or 3
   would fire, treat as incomplete.
2. **No open implementation PR** — `findMatchingOpenPrs(<specName>)` returns
   exactly zero open PRs (draft or ready). More than one match skips with a
   distinct logged reason. Inspection failure (`gh` throw) skips with logged
   reason; command continues and exits `0`.
3. **No other live patch worktree** — no `.worktree/<specName>/` directory
   besides the worktree just removed in this cleanup pass.

When any precondition fails, leave the spec directory in place, log a skip line to
stdout naming `specName` and failing guard, continue other eligible worktrees, and
do not treat the skip as a command failure (exit `0` unless another archive step
fails for a different reason). `--abandon` unchanged (never archives). `--dry-run`
unchanged (guards run only after confirmed removal; skip lines do not appear in
preview today).

## Decisions

- Gate archival on spec completion plus implementation ownership, not on "a merged PR touched this spec dir" — rules out archiving solely because the cleaned worktree's PR merged.
- Ownership key for guards 2–3 = resolved archive `specName` from `resolveSpecArchiveSource` (timestamped basename when timestamped) — rules out stripped `specNameForBranch(plan/<name>)` that misses `.worktree/<timestamped-basename>/` and impl-branch PRs.
- Spec-complete gate reads `index.md` when present (index-routed, linked subspecs) else the sole spec file under the resolved archive source directory (project root) — rules out the removed worktree copy or branch-stripped slug paths.
- Spec-complete gate calls shared exported `isSpecComplete` (triage non-human-only linked-subspec rules) — rules out a duplicated private copy in cleanup.
- Vacuous-complete (no non-human-only AC) treated as incomplete when guard 2 or 3 would fire — rules out premature archive on minimal fixtures while implementation is in flight.
- Live patch-worktree blocker excludes the worktree removed in the current item — rules out blocking archival of a merged implementation branch because its own worktree still exists mid-pass.
- Open-PR blocker uses `findMatchingOpenPrs(<specName>)`; zero matches required — rules out archiving while a draft or ready implementation PR still exists.
- More than one open PR matching `specName` skips archival with a distinct logged reason (abandon multi-PR pattern) — rules out archiving while branch ownership is ambiguous.
- `findMatchingOpenPrs` inspection failure skips archival with logged reason, continues other worktrees, exit `0` — rules out fail-open archive under `gh` failure (same posture as abandon eligibility).
- Merged worktree removal still runs when archival is skipped — rules out leaving merged plan worktrees behind while implementation is in flight.
- Skip reason logged to stdout (same channel as other cleanup skip lines) — rules out silent non-archival.
- Guard runs on both `commit:true` git-archive and `commit:false` external rename — rules out in-repo-only enforcement.
- `--abandon` bypasses archival guards — rules out coupling abandon eligibility to completion.
- `--dry-run` unchanged; archive guards run only after confirmed removal — rules out skip lines in dry-run preview today.
- Deferred to first consumer: exact skip-message tokenization beyond `specName` + guard label — pin when a caller needs stable log parsing.

## Tasks

- [ ] Export `isSpecComplete` for cleanup reuse (shared triage semantics; no private duplicate).
- [ ] Add archival precondition helper(s) in `cleanup.ts` (completion, open impl PR, other patch worktree).
- [ ] Invoke guard after merged worktree removal, before `archiveResolvedSpec` / external rename.
- [ ] Tests in `cleanup-command.sandbox-unrunnable.test.ts`: plan-merge + in-flight `.worktree/<timestamped-basename>/` skips archive; plan-merge + open impl PR on `<timestamped-basename>` skips; incomplete index skips; vacuous-complete + in-flight ownership skips; `findMatchingOpenPrs` throw skips; multiple open PRs skip; all-clear archives; queue continues after skip; `commit:false` obeys same guard.
- [ ] Update existing archive tests' fixture specs where needed so completion preconditions are satisfied (including vacuous-complete policy if happy-path fixtures lack non-human-only ACs).
- [ ] `v1/docs/operator-runbook.md` — end-of-session cleanup: document the archival guard; routine cleanup is safe after a merged plan PR while implementation continues.
- [ ] `v2/docs/v1-behaviors.md` — extend `cleanup` entry with archival preconditions.

## Acceptance criteria

- [ ] After removing a merged `plan/<name>` worktree whose archive source is `v1/spec/<timestamped-basename>/`, when `.worktree/<timestamped-basename>/` still exists, the spec directory stays in place and stdout logs a skip naming `<timestamped-basename>` and the in-flight worktree guard.
- [ ] After removing a merged `plan/<name>` worktree whose archive source is timestamped, when an open PR exists on branch `<timestamped-basename>`, the spec directory stays in place and stdout logs a skip naming `<timestamped-basename>` and the open-PR guard.
- [ ] After removing a merged worktree, when the resolved archive source still has an unchecked non-human-only acceptance criterion (index or linked subspec), the spec directory stays in place and stdout logs a skip naming the incomplete-spec guard.
- [ ] When the spec would be vacuous-complete and an in-flight patch worktree or open implementation PR exists for `specName`, archival is skipped.
- [ ] When `findMatchingOpenPrs(<specName>)` throws, archival is skipped with a logged inspection-failure reason, other worktrees continue, and exit is `0`.
- [ ] When more than one open PR matches `specName`, archival is skipped with a logged reason distinct from the single open-PR case.
- [ ] After removing a merged worktree, when all three preconditions pass, archival behaves as today (in-repo move + commit/push; external rename + ready-intent prune).
- [ ] A skipped archive for one worktree does not block cleanup of other eligible merged worktrees in the same invocation.
- [ ] Under `commit:false`, the same three guards run before external rename to `completed/`.
- [ ] `jarvis1 cleanup --abandon` behavior is unchanged (`cleanup-command.sandbox-unrunnable.test.ts` abandon tests stay green).
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v1/docs/operator-runbook.md` — end-of-session cleanup: archival waits for spec completion and no in-flight implementation PR/worktree; safe to run `jarvis1 cleanup` after a merged plan PR while implementation continues.
- `v2/docs/v1-behaviors.md` — `cleanup` command surface: archival preconditions (spec complete, no open impl PR on `specName`, no other patch worktree).
