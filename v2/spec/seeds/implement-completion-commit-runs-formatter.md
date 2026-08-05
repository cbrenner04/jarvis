---
name: implement-completion-commit-runs-formatter
---

# Implement commits unformatted code; CI `check` (biome) then fails

An `implement` write step commits agent-authored code without running the project
formatter, so the completion commit can carry biome-format violations. CI's `check`
step (`bun biome check .`) then fails on formatting alone, and the operator has to run
`bun run fix` / `bun biome check --write` by hand and push a follow-up commit before the
PR can merge. The ready gate's autofix does not cover this: it only runs when the gate
goes red *after* the completion commit, and several of these runs blocked or settled
before the gate ran.

## Evidence

- 2026-08-05, PR #2604 (mutation-checkpoint-verifier-trust): the added subprocess abort
  test tripped `biome check` (multi-line call biome wanted collapsed); CI red at ~15s
  until a hand `bun biome check --write` + push.
- 2026-08-05, PR #2609 (claude-include-partial-messages): the `stream_event` write in
  `agents.test.ts` tripped `biome check` the same way; CI red until a hand format + push.
- Recurs across agents (cursor and claude write steps both produced unformatted code).

## Decisions

- Run the project formatter as part of the completion commit path, before staging with
  `git add -A` — configured `fixCommand` or built-in `bun run fix` / `bun biome check
  --write` on the changed files — so the committed tree already passes `bun biome check`.
- Scope: format only; do not run lint autofixes that change semantics. A formatter run
  that itself fails (non-zero) must surface, not silently skip.
- This is distinct from the ready-gate autofix (which runs on a red gate after commit);
  this formats the completion commit itself so the gate/CI `check` starts clean.

## Acceptance criteria

- [ ] The implement completion-commit path runs the formatter on changed files before
      `git add -A`; a regression seeds an unformatted change and asserts the committed
      tree passes `bun biome check` (no format diff).
- [ ] A formatter command that exits non-zero surfaces a named failure rather than
      committing unformatted; a regression covers the failing-formatter path.
- [ ] Mutation checkpoint: a `// @mutate` directive removing the formatter invocation
      from the completion-commit path leaves an unformatted change committed and turns
      the regression RED; pin via a unique-basename test, naming the enclosing test.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — record that implement now formats the
  completion commit, so a green implement PR passes CI `check` without a manual format.

## Prerequisites

- The write-loop completion committer (`git add -A` boundary; `completion-commit.ts`)
- Project `fixCommand` resolution and the built-in `bun run fix` / biome invocation
- CI `check` step definition (`package.json` `check`)
