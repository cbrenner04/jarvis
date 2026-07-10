# Root-archival pass for already-merged specs

## Problem

`jarvis1 cleanup` only archives a spec when it removes that spec's worktree in
the same run (`v1/src/commands/cleanup.ts` — the removal loop resolves and
archives per-item, and the whole command early-returns before any archival
when there are zero merged worktrees to remove). A spec merged in a prior
session, or via `triage --merge` without a following `cleanup`, is never
picked up — it sits at `<targetDir>` root and the operator moves it by hand.

## Decisions

- New pass runs after the worktree-removal loop, `commit:true` only (`commit:false` external-home archival is unchanged — out of scope per intent).
- Pass runs even when `toRemove.length === 0`; rules out the current early return that skips archival entirely on a no-op worktree scan.
- Scans only `<targetDir>` root (not `v1/spec`/`v2/spec` fallback homes) for directories other than `completed`; rules out reusing the removal loop's multi-home `candidateHomes` search, which has no removed-worktree branch context to anchor a fallback guess.
- A root dir is a candidate only if `resolveCompletionSpecFile` finds an `index.md` or a sole `.md` file in it; non-spec dirs are silently skipped.
- Reuses `checkArchivePreconditions` and `archiveResolvedSpec` unmodified, called per candidate with `removedWorktreeDir` set to a sentinel that can never match a real worktree name (e.g. `""`); rules out duplicating the completeness/PR/in-flight-worktree guard logic.
- Archives via `commitArchivedSpecMove` (git add/rm --cached/commit/push), matching the existing `commit:true` removal-loop path.
- `--dry-run` prints root-archival candidates under a distinct heading from `Worktrees to remove:`, and stops before archiving (same as today's worktree preview).
- `--abandon` (global and scoped) does not run this pass; abandon never archives, unchanged.

## Task checklist

- [ ] After the worktree-removal loop (and before the current `toRemove.length === 0` early return), scan `<targetDir>` root for archivable spec dirs and archive each via `checkArchivePreconditions`/`archiveResolvedSpec`/`commitArchivedSpecMove`.
- [ ] `--dry-run` lists root-archival candidates without moving anything.
- [ ] Add tests: root spec archived with no matching worktree ever having existed this run; unchecked AC leaves it in place; open PR on the name leaves it in place; live `.worktree/<name>/` leaves it in place; zero merged worktrees to remove still runs the root-archival scan; `--dry-run` lists candidates and archives nothing; `--abandon` does not run the pass.
- [ ] Update docs per below.

## Acceptance criteria

- [ ] `jarvis1 cleanup` (default mode, `commit:true`) archives a spec dir sitting at `<targetDir>` root into `<targetDir>/completed/<spec-name>/` when it is complete, has no open PR matching its name, and no live `.worktree/<spec-name>/` — with no worktree removed for it in the same run.
- [ ] This root-archival scan runs even when zero worktrees were removed in the run (today's `no merged worktrees to remove` early return no longer skips it).
- [ ] A root spec dir with unchecked non-human-only acceptance criteria, an open PR on its name, or a live `.worktree/<spec-name>/` is left in place.
- [ ] `--dry-run` lists root-archival candidates and archives nothing.
- [ ] `jarvis1 cleanup --abandon` (global or scoped) does not archive root specs.
- [ ] `commit:false` external-home cleanup behavior is unchanged.
- [ ] `cleanup-command.sandbox-unrunnable.test.ts` existing archival/guard tests stay green.
- [ ] `bun run typecheck` and `bun run test:v1` pass.

## Documentation updates

- `v1/docs/operator-runbook.md` § End-of-session cleanup: note cleanup also archives already-merged specs found at `<targetDir>` root with no live worktree; drop the implication that only just-removed-worktree specs archive.
- `v2/docs/v1-behaviors.md`: extend the existing cleanup archival entry with the root-archival pass (a change to existing cleanup functionality).
