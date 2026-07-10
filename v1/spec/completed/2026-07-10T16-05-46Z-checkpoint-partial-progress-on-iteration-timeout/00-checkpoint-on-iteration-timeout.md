# Commit uncommitted edits as a WIP checkpoint on iteration-timeout

When the `aborted: iteration-timeout` branch in `v1/src/modes/patch/iteration.ts`
(exit 8) fires, any agent edits still in the worktree are lost to the next
iteration because nothing commits them. Checkpoint them instead.

## Decisions

- Scope is the iteration-timeout branch only (`aborted: iteration-timeout`,
  around `v1/src/modes/patch/iteration.ts:915` — approximate, will drift with
  unrelated edits) — not idle-timeout or run-timeout, and not the
  `agent-error` exit-3 path, which already commits partial progress.
- Gate the checkpoint on `gitEnabled && !specIsExternal` (the same condition
  `hasUntrackedMutations` already negates) — external/no-commit runs keep
  relying on `no-commit-delta.ts`'s reset instead.
- Detect "changes present" via staged status after `git add -A` (mirrors
  `commitWipProgress`'s existing `ops.hasStagedChanges` check), and commit
  whatever is staged — including new untracked files the agent created, not
  only edits to already-tracked paths. Losing a new file the agent authored
  this iteration is the same failure mode as losing an edit, so scope is not
  narrowed to tracked-only paths.
- No ordering conflict with `commitLockfileChanges`: dep-install and lockfile
  commit only run from the post-agent-success path (after the agent process
  exits cleanly), never before the `aborted: iteration-timeout` check. An
  iteration that times out never reaches `maybeInstallDeps`, so the
  checkpoint commit's `git add -A` cannot re-sweep or duplicate a lockfile
  commit — there is nothing else to sequence against on this path.
- The checkpoint commit message is a distinct WIP variant that does not
  reference acceptance criteria (e.g. `WIP: checkpoint (iteration-timeout)` +
  agent trailer) — separate from `commitWipProgress`, whose message format
  implies AC-tracked progress.
- No AC or index checkbox is touched by this commit.
- Commit failure is best-effort: log to stderr and still return exit 8 (same
  posture as the existing `commitLockfileChanges` failure handling) — a
  checkpoint-commit error must not mask the timeout as a harder failure.

## Prerequisites

- `hasUntrackedMutations` (`v1/src/modes/patch/iteration.ts`) — the existing
  `gitEnabled`/`specIsExternal` condition this checkpoint's gate negates.
- `commitWipProgress` and its `ops.hasStagedChanges` check
  (`v1/src/modes/patch/subspec.ts`) — precedent for staged-status detection
  and WIP commit-message shaping.
- `commitLockfileChanges` (`v1/src/modes/patch/dep-install.ts`) — its
  best-effort failure handling (log + continue) is the precedent this
  subspec's commit-failure posture follows.

## Task checklist

- [ ] Add a checkpoint-commit path fired from the `aborted: iteration-timeout`
      branch, gated on `gitEnabled && !specIsExternal`.
- [ ] Run `git add -A` and commit only when it produces staged changes
      (tracked edits or new untracked files); no-op otherwise.
- [ ] Commit message carries no AC/completion claim and includes the agent
      attribution trailer.
- [ ] Commit failure is caught, logged to stderr, and does not change the
      exit-8 return.

## Acceptance criteria

- [x] A `git: true`, non-external-spec run whose agent leaves uncommitted
      tracked edits at iteration-timeout has those edits committed to the
      worktree branch before the run exits 8.
- [x] A `git: true`, non-external-spec run whose agent creates a new
      untracked file at iteration-timeout has that file committed alongside
      any tracked edits, not left untracked.
- [x] The checkpoint commit does not tick any acceptance criteria in the
      active subspec and does not modify `index.md`.
- [x] A `git: false` (no-commit) or external-spec run behaves unchanged at
      iteration-timeout — no checkpoint commit attempted, existing
      `no-commit-delta.ts` reset still applies on the next invocation.
- [x] An iteration-timeout with no uncommitted changes (agent made no edits,
      or edits were already committed) exits 8 with no new commit created.
- [x] An iteration-timeout where the checkpoint commit itself fails (e.g.
      `git commit` errors) logs the failure to stderr and the run still
      exits 8, not a harder or different exit code.
- [x] An iteration-timeout on an iteration whose only change is a
      dep-install-regenerated lockfile still produces at most one commit —
      the checkpoint path does not duplicate a lockfile commit, since
      dep-install/`commitLockfileChanges` only run on the post-agent-success
      path and never precede this abort branch.

## Documentation updates

- `v1/docs/run-loop.md` § "Stop conditions and exit codes": note the exit-8
  row now commits a WIP checkpoint of uncommitted changes (tracked edits and
  new untracked files, when `git: true` and the spec isn't external) before
  returning.
- `v1/docs/operator-runbook.md` § "Manual-finalize recovery (last-resort
  path)": update the idle/iteration-timeout guidance so it no longer implies
  the operator must hand-reconcile uncommitted work accumulated across
  timeouts — a checkpoint commit now preserves it automatically.
- `v2/docs/v1-behaviors.md`: record that iteration-timeout (exit 8) commits a
  WIP checkpoint of uncommitted changes, scoped to `git: true` +
  non-external-spec runs.
