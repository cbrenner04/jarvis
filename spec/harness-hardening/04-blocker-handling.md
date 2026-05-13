# 04 — Blocker handling

## Problem

`rules.md` in patch mode instructs the agent to append a `## Blocker`
section to the active subspec and stop when ambiguous or blocked.
`src/modes/patch/blocker.ts` contains helpers (`recordBlocker`,
`commitBlocker`) but nothing in `src/modes/patch/run.ts` ever calls them
or detects a newly written blocker. The agent does the right thing; the
harness ignores it. The loop then re-prompts the same task until
`maxIterations` or the no-progress catch.

This wastes money. Each re-prompt is a fresh agent invocation against a
spec the agent has already declared blocked.

## Behavior

After each iteration in `runCommand`:

1. If the active subspec gained a `## Blocker` section that was not present
   before the iteration ran, the run is blocked.
2. Before stopping, commit any WIP progress from the same iteration. If
   acceptance criteria were newly checked in the same iteration that
   produced the blocker, commit them together as a single combined commit:
   `WIP: <h1> (blocked, N/M criteria)` with body listing newly-checked
   criteria and the blocker text. If no criteria were newly checked, the
   commit is `WIP: <h1> (blocked)` with the blocker body.
3. The commit uses the heredoc-free path from subspec 03.
4. Push the commit if `gitEnabled` and `!skipGhCheck`, using the same push
   logic as the WIP path.
5. Print the blocker body to stderr verbatim, prefixed with the subspec
   path. Send it to the log server as a `harness` tag.
6. Exit with code `7` ("blocked").
7. Do not invoke the agent again. Do not run PR body generation. Do not
   mark the PR ready.

A subspec that *already* contained `## Blocker` at the start of the run is
treated as still-blocked: the run refuses to start that iteration and
exits 7 immediately with a message naming the subspec and the blocker
text. The operator must remove the section (or fix the underlying issue)
before rerunning.

Snapshot logic: at iteration start, record `hasBlockerBefore: boolean`
from the active subspec. After the iteration, re-read and compare. Use a
header-level-strict regex matching `## Blocker` exactly (subspec 06 will
provide the parser; until then, an inline regex is fine).

## Tasks

- [ ] Detect `## Blocker` at iteration start (refuse) and at iteration end
      (commit + exit).
- [ ] Build the combined WIP+blocker commit path; reuse subspec 03's
      heredoc-free commit helper.
- [ ] Wire push of the blocker commit when git is enabled.
- [ ] Add exit code `7` to `docs/run-loop.md`.
- [ ] Remove the unused `recordBlocker` export if the new path
      consolidates the helpers; keep only what is called.
- [ ] Tests: agent appends `## Blocker` → run commits and exits 7;
      starting a run on a subspec that already has `## Blocker` exits 7
      without invoking the agent; iteration that both ticks criteria and
      adds blocker produces one combined commit.

## Acceptance criteria

- [ ] An iteration whose output added a `## Blocker` section to the active
      subspec exits with code `7` and the agent is not re-invoked.
- [ ] The exit-7 path always commits (and pushes when git is enabled) the
      iteration's work, including any newly-checked criteria, in a single
      commit.
- [ ] A run started against a subspec that already has `## Blocker` exits
      `7` without invoking the agent.
- [ ] The blocker body is printed to stderr.
- [ ] `docs/run-loop.md` documents exit code `7`.
- [ ] `bun run typecheck` passes.
- [ ] `bun test` passes.

## Documentation updates

- `docs/run-loop.md`: exit code `7` (blocked) and the rules for when it
  fires.
- `src/modes/patch/rules.md`: confirm the existing "append `## Blocker`
  and stop" guidance and note that jarvis now honors it.
