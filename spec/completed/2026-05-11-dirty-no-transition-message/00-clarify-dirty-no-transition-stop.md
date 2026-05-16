# 00 - Clarify dirty no-transition stop

## Problem

When an agent edits files but fails to check the active linked subspec in the
index, `jarvis run` currently says:

```text
iteration N produced no subspec checklist transition, but the worktree is not clean ...
```

That is accurate for the harness, but it leaves the operator to infer what
happened and how to recover. It also reuses exit code `6`, whose docs currently
describe only the all-checklists-complete dirty-worktree case.

## Behavior

- Keep the existing contract: Jarvis must not commit or push dirty work unless
  exactly one linked subspec checkbox transitions from unchecked to checked.
- When an index run produces no linked subspec transition and the worktree is
  dirty, print a stop message that explicitly says the agent edited files
  without checking the active index item.
- The stop message should tell the operator to inspect the dirty worktree, then
  either finish/check the active subspec or revert/fix the changes before
  rerunning.
- Document that exit code `6` covers both dirty completion and dirty
  no-transition stops.

## Tasks

- [x] Update the dirty no-transition message in `src/commands/run.ts`.
- [x] Add or update a regression test for the dirty no-transition message.
- [x] Update `docs/run-loop.md` exit-code text.

## Acceptance criteria

- A dirty worktree with no linked subspec transition exits `6` with an
  actionable message naming the missing active index checkbox transition.
- Existing completed-but-dirty behavior still exits `6`.
- `bun run typecheck` passes.
- `bun test` passes.

## Documentation updates

- `docs/run-loop.md`: clarify exit code `6`.
