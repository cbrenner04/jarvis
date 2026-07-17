# Retire merged v2 workspaces

## Problem

`jarvis cleanup` does not discover v2 worktrees under `~/.jarvis/worktrees/`, so merged workspaces and local branches accumulate unless the operator removes them manually.

**Three** prior implementations were rejected on review, every one with all acceptance criteria ticked and a green gate (PRs #1672, #1675, #1682).

- #1672: permanent no-op behind an invalid `gh pr view --head` flag, hidden by a stub matching the command name.
- #1675: `rmSync` with no `git worktree remove`, orphaning the branch registration; daemon-down read as permission.
- #1682: got the seams and the git commands right, but **never wired the guards into the production CLI** — `getNonTerminalRuns` and `isDaemonRunLive` defaulted to `() => []` / `() => false`, so the real command never contacted the daemon and would delete a live worktree. Its 13 tests injected the *high-level* predicates, so no test ever executed a `gh` path: reverting to the invalid `--head` flag and flipping the gh catch to fail-open **both left the suite green**.

The lesson from #1682 is why the seam rules below are strict. A high-level injection point is a bypass: the agent injects the predicate, the argv assertion never runs, and the production path stays untested. **The subprocess runner and the daemon client are the only permitted seams.**

## Decisions

- Discover worktrees from v2's external home and resolve their registered project roots; rules out limiting cleanup to v1's repo-local `.worktree/` layout.
- Take the worktrees home as an injectable `jarvisRoot`, defaulting to `jarvisHome()` exactly as `getExternalWorktreePath` does (`v2/src/execution/external-worktree.ts:47`); rules out resolving `~/.jarvis` internally, which leaves no seam and forces tests to mock around the unit under test.
- Take the subprocess seam as an injectable `AsyncSubprocessRunner` (`shared/subprocess.ts`), defaulting to `realAsyncSubprocessRunner`, and route **every** `gh` and `git` call through it — including the merged-PR check; rules out an ambient spawn that only a command-name-matching stub can intercept, and rules out #1682's `defaultIsMergedPr` calling `realAsyncSubprocessRunner` directly while tests inject past it.
- The **only** injectable seams are `jarvisRoot`, the `AsyncSubprocessRunner`, and the daemon client. Eligibility predicates (`isMergedPr`, `getNonTerminalRuns`, `isDaemonRunLive`) are **not** injectable and have **no defaults** — they are computed internally from those three seams; rules out #1682, where injecting the predicates meant no test ever exercised a `gh` argv or the daemon.
- Ownership inputs are required, not defaulted: the command reads the durable run store and queries the daemon on every real invocation. A missing or unreachable source is an error that yields *ineligible*, never an empty result; rules out `?? (() => [])` / `?? (() => false)` defaults that fabricate "no runs, not live" and read as permission.
- Retire a worktree via `git worktree remove` plus `git worktree prune` before deleting the local branch; rules out `rmSync` of the directory, which leaves the `.git/worktrees/` registration behind and makes the subsequent branch delete fail.
- Require a merged PR and no open or daemon-live run for the workspace at removal time; rules out age-based retirement and preview-to-confirm ownership races.
- Fail closed when PR or live-ownership inspection is unavailable — an unreachable daemon or a failing `gh` call yields *ineligible*, never an empty result set read as permission; rules out treating an inspection outage as retirement permission.
- Remove only the worktree and local branch; rules out remote-branch deletion, spec archival, ready-intent pruning, and durable run-row deletion.
- Keep `jarvis cleanup`, `--dry-run`, and `[y/N]`; rules out a v2-only command or implicit destructive execution.

## Work

- Add merged-workspace discovery and retirement for registered projects under `~/.jarvis/worktrees/<project>/`, including nested branch paths. A directory is a candidate only when it is a real worktree — an empty directory (e.g. the `plan/` and `intent/` parents) is not.
- Exclude any workspace referenced by a non-terminal durable run or a daemon-reported live run, and recheck ownership before removal.
- Inspect PR state, preview each worktree path and local branch, support mutation-free `--dry-run`, prompt before mutation, and report removal failures without deleting run history.
- Route the top-level CLI command and cover command parsing, cancellation, safety guards, and successful retirement.
- Align the command reference, operator runbook, and first-workflow close-out.

## Acceptance criteria

- [ ] `jarvis cleanup --dry-run` discovers merged-PR worktrees beneath each registered project's `~/.jarvis/worktrees/<project>/` home, including slash-nested branch paths, and previews both worktree and local-branch removals without prompting or mutating state.
- [ ] `jarvis cleanup` prompts `[y/N]`; declining changes nothing, while confirmation removes each still-eligible worktree registration/directory and its local branch without deleting the remote branch, specs, ready intents, or durable run rows.
- [ ] A worktree is omitted when its PR is not merged, PR or ownership inspection cannot establish eligibility, a non-terminal durable run references it, or the daemon reports a referencing run live; ownership is rechecked after confirmation before removal.
- [ ] Cleanup handles registered projects independently, leaves an ineligible or failed candidate intact, and exits nonzero when a confirmed retirement fails.
- [ ] Retirement leaves no stale `.git/worktrees/` registration: after a confirmed removal, `git worktree list` no longer names the path and the local branch delete succeeds. Re-running cleanup over the same already-retired workspace is a no-op, not a failure.
- [ ] The **production** `jarvis cleanup` path contacts the daemon and reads the durable run store on every real invocation. A test drives the real CLI entry (`v2/src/cli.ts`) with only the permitted seams injected and asserts the daemon was queried; with the daemon unreachable, a candidate whose PR is merged is reported **ineligible**, not removed.
- [ ] `v2/src/commands/cleanup.test.ts` and `v2/src/cli.test.ts` drive discovery against a temp `jarvisRoot` holding real materialized worktrees — never a registry whose root does not exist or is empty — and every test asserts a non-empty candidate set before asserting the behavior under test, so a zero-candidate early return cannot satisfy it.
- [ ] Every `gh` and `git` expectation asserts the full argv the injected `AsyncSubprocessRunner` received, not the executable name. The suite contains at least one assertion on a `gh` argv; reverting the merged-PR check to `gh pr view --head <branch>` (an invalid flag for `gh pr view`) turns the suite red.
- [ ] Each safety guard is individually load-bearing — verify by mutation, not by inspection. Each of these turns at least one test red: reverting the gh call to the invalid `--head` form; making the gh failure path fail **open**; bypassing the merged-PR check; bypassing the non-terminal-durable-run check; bypassing the daemon-live check; bypassing the post-confirmation recheck; replacing `git worktree remove` with `rmSync`.
- [ ] `bun run check`, `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.
- [ ] `v2/docs/write-behavior.md`, `v2/docs/operator-runbook.md`, and `v2/docs/first-workflow-walkthrough.md` document the cleanup command, preview/confirmation flow, safety guards, retained artifacts/history, and session-end invocation.

## Documentation updates

- Update `v2/docs/write-behavior.md` with the `jarvis cleanup [--dry-run]` CLI contract.
- Update `v2/docs/operator-runbook.md` with merged-workspace cleanup and safety guards.
- Update `v2/docs/first-workflow-walkthrough.md` with session-end cleanup.
