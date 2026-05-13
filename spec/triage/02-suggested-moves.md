# 02 - Rule-based suggested-next-moves table

## Problem

After the drill-down sections render, the user still has to translate
"here is the state" into "what do I type next." A small rule table can
do that translation deterministically for the common shapes of dirty
worktree we see in practice. The suggestions are advisory text only —
nothing is executed.

## Decisions

- The section header is `Suggested next moves`. Output is a numbered
  list of 2–4 items. Each item is one line (or two if a command needs
  a preceding explanation), formatted as shell-pasteable commands with
  `<path>` already substituted to the absolute worktree path so the
  user can copy without further editing.
- Inputs to the rule table, derived from the section gatherers:
  - `dirtyKind`: `clean` | `untracked-only` | `modified` | `mixed`
    (modified + untracked). Computed from porcelain status codes.
  - `unpushed`: integer count of commits ahead of upstream (`0` if no
    upstream).
  - `prState`: `none` | `DRAFT` | `OPEN` | `MERGED` | `CLOSED` |
    `unknown` (gh unavailable).
  - `specComplete`: boolean (countUnchecked === 0 and no unmet
    acceptance criteria).
- The table is hand-written and small. Order matters: the first
  matching rule wins. The first cut covers these cases (any state not
  listed here falls through to a generic "inspect with `git -C <path> diff`"
  suggestion):

  1. `clean` + `unpushed > 0` + `prState ∈ {none, DRAFT, OPEN}`
     → `git -C <path> push`
  2. `clean` + `prState = MERGED`
     → "PR is merged. Safe to remove with `jarvis cleanup`."
  3. `untracked-only` (and the untracked files are only under the
     spec directory)
     → `git -C <path> add <files> && git -C <path> commit -m "seed spec"`
     then `git -C <path> push`
  4. `modified` or `mixed` + `prState = MERGED`
     → "PR is merged but this tree has uncommitted work — probably
       orphaned. Inspect: `git -C <path> diff`. Discard:
       `git -C <path> stash && jarvis cleanup`."
  5. `modified` or `mixed` + `specComplete = true`
     → "Spec checklists are complete. Commit and push so the PR
       reflects: `git -C <path> add -A && git -C <path> commit && git -C <path> push`."
  6. `modified` or `mixed` + `specComplete = false`
     → "Inspect: `git -C <path> diff`. Resume:
       `jarvis run <spec-path>`. Discard:
       `git -C <path> reset --hard && git -C <path> clean -fd`."
  7. Fallback: "Inspect: `git -C <path> diff` and the session log
     above."

- "Spec directory" for rule 3 is the directory containing the spec
  resolved by Identity. The check is purely path-prefix based; if the
  spec marker is missing, this rule does not match and we fall through.
- `prState = unknown` rules: treat as worst-case (do not suggest
  destructive moves). Rules 4 only fires on confirmed `MERGED`.
- No rule suggests `git push --force`, `branch -D`, `--no-verify`, or
  any flag that bypasses hooks. If the user wants those, they type
  them themselves.

## Implementation hints

- Keep the rules as a single ordered array of `{ match: (input) => boolean, format: (input) => string[] }` in `src/commands/triage.ts` (or a sibling file if the file gets large). Tests construct synthetic inputs and assert the rendered lines — no need to spin up real worktrees just to test the table.
- `dirtyKind` computation: parse porcelain lines. Codes starting with
  `??` are untracked; anything else is modified. Empty porcelain →
  `clean`.

## Task Checklist

- [ ] Define the `SuggestedMovesInput` type and the
  `dirtyKind`/`unpushed`/`prState`/`specComplete` computations,
  reusing data from subspec 01's gatherers.
- [ ] Implement the rule table with the seven cases above plus the
  fallback.
- [ ] Wire it into the report between Session log and the end of
  output.
- [ ] Tests construct each rule's input shape and assert the rendered
  lines. Include a test for the fallback case.
- [ ] Test that `prState = unknown` never produces a destructive
  suggestion.
- [ ] Test that the untracked-only-in-spec-dir branch does not fire
  when untracked files exist outside the spec dir.

## Acceptance criteria

- [ ] For each rule, the rendered suggestion matches the format above
  and substitutes the absolute worktree path.
- [ ] No suggestion contains `--force`, `-D`, or `--no-verify`.
- [ ] `prState = unknown` falls through to the safe fallback regardless
  of dirty kind.
- [ ] Suggestions are printed as informational text; nothing is
  executed by triage.
- [ ] `bun run typecheck`, `bun test`, `bun run check` all pass.

## Documentation updates

- `docs/worktrees-and-commits.md`: append the rule table (or a
  summary of it) so users can predict what triage will suggest.
