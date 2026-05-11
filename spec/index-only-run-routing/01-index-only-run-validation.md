# 01 — Index-only run validation

## Problem

`jarvis run` currently accepts any Markdown spec path. A flat spec with many
task checkboxes can be passed directly to the loop, and if the underlying agent
checks every box in one successful run, Jarvis treats the spec as complete.

Jarvis should keep responding to agent exit categories and spec completion, but
it should guide users toward index-routed specs by default.

## Decisions

- Normal `jarvis run` input must be an `index.md` file.
- A non-index Markdown spec is treated as a one-iteration spec only after
  explicit user confirmation.
- `00-runaway-visibility.md` supersedes the earlier no-delta decision: normal
  loop runs now stop when a successful agent iteration leaves the unchecked-task
  count unchanged.
- Existing flat specs are not migrated or rewritten.
- The completed `spec/register-only-init-and-harness-rules.md` file is left as
  historical work.

## Behavior

### Index specs

When the spec path basename is `index.md`, `jarvis run <spec-path>` behaves as
it does today:

- Resolve the spec path.
- Find the registered project root.
- Loop until the spec has no unchecked boxes, all agents are quota-exhausted,
  an agent returns a non-quota error, or the user interrupts.

### Non-index specs

When the spec path basename is not `index.md`, Jarvis should not silently enter
the normal loop.

Instead, before invoking any agent, Jarvis should print a clear prompt explaining
that normal runs expect an index spec and ask whether to run the supplied spec
as a one-iteration spec.

Suggested prompt text:

```text
jarvis run expects an index spec.
Run <SPEC_PATH> for one agent iteration anyway? [y/N]
```

If the user declines or submits an empty answer:

- Exit 1.
- Do not invoke an agent.
- Do not modify the spec.

If the user confirms:

- Invoke one agent iteration using the supplied spec path.
- Respect quota fallback before that one work iteration. A quota result does not
  count as the one agent iteration.
- After one successful `ok` result, check completion and print the same
  completion message if complete.
- If the spec is still incomplete after that one successful `ok` result, exit 0
  with a clear message that the one-iteration run finished with unchecked tasks
  remaining.
- Preserve existing handling for quota exhaustion, non-quota agent errors, and
  SIGINT.

## Tasks

- [x] Add run-command validation that distinguishes `index.md` specs from
  non-index specs.
- [x] Add an interactive confirmation path for non-index specs.
- [x] Limit confirmed non-index runs to one successful agent `ok` iteration,
  while preserving quota fallback behavior.
- [x] Add tests for:
  - `index.md` specs continuing to loop normally
  - non-index specs declining confirmation without invoking an agent
  - non-index specs accepting confirmation and running one successful work
    iteration
  - quota fallback during a confirmed one-iteration non-index run
  - incomplete non-index specs exiting after one successful work iteration
- [x] Update README usage docs to explain that normal runs expect an `index.md`
  spec and that direct spec files require confirmation for one iteration.

## Acceptance criteria

- `jarvis run spec/some-feature/index.md` uses the normal loop.
- `jarvis run spec/some-feature/01-task.md` asks for confirmation before any
  agent is invoked.
- Declining the confirmation exits 1 without invoking an agent.
- Confirming the prompt runs at most one successful agent work iteration for the
  non-index spec.
- Quota fallback can happen before the one successful work iteration.
- Jarvis does not inspect or enforce how many checkboxes changed during an
  iteration.
- `bun run typecheck` passes.
- `bun test` passes.

## Documentation updates

- README: document that `jarvis run` normally expects an `index.md` spec.
- README: document the confirmed one-iteration escape hatch for direct spec
  files.
