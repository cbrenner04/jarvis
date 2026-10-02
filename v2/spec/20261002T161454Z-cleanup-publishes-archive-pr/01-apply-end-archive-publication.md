# Apply-end cleanup archive push and ready PR

## Problem

Successful cleanup apply commits in-repo archives locally then prints manual push/PR instructions (`reportArchiveSessions`). Operators leave branches unpushed, which blocks later archives and leaves specs stranded on disk until someone runs `gh` by hand.

## Prerequisites

- `publishArchiveReady` in `completion-publisher.ts` (push then open-or-reuse ready archive PR, injectable `git`/`gh`) is the only cleanup archive publication seam — rules out a parallel cleanup-only `gh` wrapper or a prerequisite that greps for separate push/PR exports.

## Decisions

- After a successful apply, invoke `publishArchiveReady` once per registered publication target from subspec 00 (non-empty target set); no cleanup-level preflight that skips targets already on `origin` — rules out duplicating remote/PR list gating outside the publisher.
- Open vs closed PR and idempotent reuse live inside `publishArchiveReady` / `findOrOpenReuseArchivePr` (push always attempted; sole open PR reused without a second `gh pr create`; archive path does not apply lane closed/merged guards) — rules out cleanup interpreting intent "still needs remote/PR" as a separate skip before calling the publisher.
- `baseRef` is the project default branch; PR `title` is `Archive completed specs for <project>` (same `<project>` token as today's `Archive branch for <project>:` line); PR `body` is one line `Branch <branch> at <worktreePath>.` passed verbatim to `publishArchiveReady` — rules out ad hoc per-run titles that drift from dry-run preview and create args.
- Idempotent reuse: `publishArchiveReady` open-or-reuse semantics apply; stdout prints the PR URL (create or reuse) — rules out always printing the legacy manual-instruction line on success.
- Push or PR failure after local archive commits does not roll back commits or delete the branch; output names the failing step (`push` vs `pr`) and repeats the `reportArchiveSessions` manual line for that target (`Archive branch for <project>: <branch> (<n> commit(s)) at <worktreePath> — push it and open one archive PR.`, same shape as `cleanup.test.ts` ~1546–1548), then exit non-zero — rules out paraphrased fallback text and treating publication failure as archive rollback.
- `--dry-run` prints `push: <branch>` and `open PR: Archive completed specs for <project>` for each publication target that would run, with no `git push` or `gh` calls — rules out silent dry-run omission for archive publication.
- Cleanup never merges the archive PR — rules out auto-merge or ready-gate flip in this command.
- Deferred to first consumer: whether archive publication uses `runPublicationWithRetry` — follow `publishArchiveReady` caller policy chosen in cleanup wiring.
- Deferred to first consumer: multi-project single apply (`N` targets ⇒ `N` publications), publisher error normalization on cleanup stderr, exit-code precedence when the archive loop already failed — pin when fixtures require them on first ship.

## Task checklist

- [x] Replace successful-path `reportArchiveSessions` manual instructions with apply-end `publishArchiveReady` per publication target (depends on subspec 00 targets).
- [x] Wire dry-run preview lines for archive push/PR without network.
- [x] Map push and PR failures to non-zero exit with failing step plus `reportArchiveSessions`-shaped manual fallback text.
- [x] Update `cleanup.test.ts` success-path archive stdout from the manual `reportArchiveSessions` line to the published PR URL.
- [x] Add apply-level tests in `cleanup-archive-publication.test.ts` and `cleanup.test.ts` per acceptance criteria.

## Acceptance criteria

- [x] `cleanup-archive-publication.test.ts`: an apply that produced new archive commits on the session branch pushes the branch and calls `gh pr create` once with the default base and title `Archive completed specs for <project>`; stdout names the PR URL; fails against current code (`reportArchiveSessions` manual line only, no push/PR).
- [x] The same file: a pre-existing local `cleanup/archive-*` branch carrying a staged archive (no new archive commit this run) is pushed and gets `gh pr create` once on apply end; stdout names the PR URL; fails against current "already staged" skip-only behavior without apply-end publication.
- [x] The same file: an existing open PR for the branch is reused (no second `gh pr create`) and stdout names that PR URL; fails against current code as above.
- [x] The same file: push failure leaves local archive commits intact, prints the failing step plus an `Archive branch for <project>: … — push it and open one archive PR.` line matching the `cleanup.test.ts` ~1546–1548 pattern, and exits non-zero; fails against current code that never attempts push.
- [x] The same file: PR open/create failure after a successful push leaves local commits and the remote branch, prints the failing step plus the same manual fallback line shape as above, and exits non-zero; fails against current code as above.
- [x] `cleanup.test.ts`: `--dry-run` prints `push: <branch>` and `open PR: Archive completed specs for <project>` and performs no `git push` or `gh` invocation; fails against current dry-run output that omits archive publication preview.
- [x] `cleanup.test.ts`: successful in-repo archive apply stdout names the archive PR URL and does not match the `reportArchiveSessions` manual line (`Archive branch for … — push it and open one archive PR.`); fails against current code at ~1546–1548.
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Merged-worktree retirement — cleanup opens the archive PR; operator reviews and merges it (replace manual push/PR as the normal path).
- `v2/docs/v1-behaviors.md` — cleanup archive auto-publication via `publishArchiveReady` and stdout PR URL; align staged-branch bullet with subspec 00 recovery.
