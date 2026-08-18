---
name: harness-publication-push-uses-explicit-refspec
---

# Completion publication's bare `git push` strands the PR when the branch tracks a differently-named upstream

## Problem

The workflow completion/publication step runs a bare `git push` in the managed worktree. When the implement branch's upstream tracks a differently-named ref — e.g. the worktree was materialized from `--base origin/main`, so `git checkout -b <branch> origin/main` set its upstream to `origin/main` — bare `git push` under the default `push.default=simple` refuses with "The upstream branch of your current branch does not match the name of your current branch", and completion settles `completion_commit_failed` (or the publication successor dies) with the branch never pushed and no PR created. The implemented code is complete on the worktree; only publication strands, so the failure looks like a harness/infra error rather than a code problem.

## Evidence (2026-08-18)

Three implements launched with `--base origin/main` stranded publication this way in one session: the TUI divider (publication successor died `invocation_error`), ready-gate 01+02 (`completion_commit_failed`, whose error text is the verbatim git upstream-mismatch hint), and the resume-CLI (compounded by a stale base). A repo-local `git config push.default current` worked around it (a `jarvis run resume` then pushed successfully), but the harness should not depend on operator-set git config.

## Decisions

- Publication pushes with an explicit refspec — `git push origin HEAD:<branch>`, where `<branch>` is the run's target branch — so it is robust to whatever upstream the branch tracks and does not depend on `push.default`. Rules out relying on bare `git push` plus a correct upstream, and rules out the harness mutating global/repo git config.
- Applies to the initial publication push and any resume/retry publication push on the same path.
- Out of scope: whether `--base <remote-tracking-ref>` should be normalized or rejected at admission (a separate concern); this seed only hardens the push itself.

## Acceptance criteria

- [ ] A completion publication whose branch tracks a differently-named upstream (a real branch with `push.default=simple` and upstream `origin/main`, or a captured-argv test) pushes successfully via the explicit `origin HEAD:<branch>` refspec where a bare `git push` would refuse — pinned by a test capturing the push argv or driving a mismatched-upstream branch.
- [ ] Publication push behavior for a branch with a matching upstream or no upstream is unchanged.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- The workflow publication-landing docs (`v2/docs/workflow-runner.md` / `daemon-host.md` publication section) — note the completion push uses an explicit refspec and is independent of the branch's upstream and `push.default`.
