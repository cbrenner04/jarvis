# 02 — Deterministic spec-name derivation

## Problem

This skeleton-stage spec needs a `<name>` to derive the worktree path,
branch, and `spec/<name>/` directory **without** calling an agent.
Subspec 01 assumed a name was already chosen; this subspec produces it
deterministically from the input mode and ensures uniqueness against
existing `spec/<name>/` directories.

Agent-proposed names land later in
`spec/plan-mode-interview/03-agent-proposed-spec-name.md`.

## Decisions

- **Derivation rules:**
  - **File mode:** take the intent file basename, drop the extension,
    kebab-case the result (lowercase, replace runs of non-`[a-z0-9]+`
    with `-`, strip leading/trailing `-`). Empty result → fallback
    `plan`.
  - **Inline mode:** take the inline text, lowercase, kebab-case as
    above, then truncate to the first 6 words / 40 characters
    (whichever comes first). Empty result → fallback `plan`.
  - **Interactive mode:** this subspec does **not** apply; interactive
    mode continues to hit the skeleton stub exit. Document this with a
    comment at the dispatch point.
- **Uniqueness check.** After deriving the candidate name, check all
  three of:
  - `<projectRoot>/spec/<name>/` exists in the working tree of the
    project's main checkout (we read from disk, not from git history).
  - `<projectRoot>/.worktree/plan-<name>/` exists.
  - The remote branch `plan/<name>` exists, queried with
    `git ls-remote --heads origin plan/<name>`. This catches the
    case where a previous plan run pushed a branch but its local
    worktree was cleaned up, or where another machine pushed a plan
    branch with the same name.

  If any of the three exists, append `-2`, `-3`, ... until **all
  three** are free. The same suffix must apply to all three checks;
  never end up with `spec/foo-2` but `.worktree/plan-foo-3`.

  **Race window.** The local-disk checks and the `ls-remote` check
  are not atomic with worktree creation in subspec 01. A concurrent
  patch-mode run or a competing plan run on the same machine can
  create a colliding directory between the check and the
  `git worktree add`. Subspec 01's worktree creation already exits
  `1` with an actionable message in that case (`plan worktree
  already exists at <path>; resolve with \`jarvis cleanup\` or
  remove manually`); that error stays the user-visible recovery
  path. We do not retry the suffix loop after a collision: the user
  has explicit information about what happened and a one-line fix.
- **Inline-mode kebab + truncate ordering.** The transformation is:
  lowercase → kebab-case (collapse non-`[a-z0-9]+` to `-`) →
  truncate to first 6 words (split on `-`) → cap at 40 characters
  → strip leading/trailing `-`. The leading/trailing `-` strip
  happens **after** truncation so a truncated trailing `-` cannot
  leak into the final name. If the result is empty after stripping,
  fall back to `plan`.
- **Branch-name collision** is now caught up-front by the
  `ls-remote` check above. If `git worktree add -b` still fails (for
  example, because a local branch `plan/<name>` exists without a
  remote counterpart), surface the git error with an actionable
  prefix: `plan: local branch plan/<name> already exists; delete it
  with \`git branch -D plan/<name>\` and re-run`. Exit `1`.
- **Reserved names.** Reject `index`, `intent`, and any name that would
  produce an invalid filesystem path. On rejection, fall back to
  `plan` and re-run the uniqueness loop.
- **Logging.** Print one stderr line: `plan mode: spec name=<name>` so
  reviewers can confirm derivation worked.
- **No agent calls.**

## Implementation hints

- Pure helper: `deriveSpecName({ mode, intentPath?, intentText?,
  projectRoot }): string`. Easy to unit-test.
- Keep the kebab-case helper local to this module unless an existing
  one already exists in the codebase; if so, reuse it.
- Wire the helper into `planCommand` in `src/commands/plan.ts`. The
  parsed invocation already distinguishes file/inline/interactive
  modes via `result.invocation.mode` (see `parsePlanArgs` in
  `src/commands/plan-args.ts`); branch on that.

## Tasks

- [ ] Implement `deriveSpecName` with the rules above.
- [ ] Wire it into `planCommand` between repo resolution and worktree
  creation (subspec 01 then receives the chosen name).
- [ ] Tests:
  - File mode: various basenames produce the expected kebab-case.
  - Inline mode: long text is truncated to 6 words / 40 chars, with
    trailing `-` stripped after truncation (input
    `"add csv export to reports !!!"` → `add-csv-export-to-reports`,
    not `add-csv-export-to-reports-`).
  - Empty / all-punctuation input falls back to `plan`.
  - Reserved names (`index`, `intent`) trigger the fallback.
  - Existing `spec/<name>/` directory triggers `-2` suffix; both name
    and worktree path agree on the suffix.
  - Existing `.worktree/plan-<name>/` directory alone triggers `-2`.
  - Existing remote branch `plan/<name>` (mocked `ls-remote` output)
    alone triggers `-2`.
  - All three colliding requires going to a higher suffix to satisfy
    them all.
  - Existing local-only branch `plan/<name>` after suffix loop
    completes surfaces the documented `git branch -D` error
    (mocked).

## Acceptance criteria

- [x] `<name>` is derived deterministically from file or inline input
  per the rules above.
- [x] Collisions with existing `spec/<name>/`, `.worktree/plan-<name>/`,
  or remote `plan/<name>` branches are resolved by suffixing.
- [x] Local-only branch collisions surface the documented actionable
  error.
- [x] Interactive mode continues to hit the skeleton stub exit (no
  derivation attempted).
- [x] No agent is invoked.
- [x] `bun run typecheck`, `bun test`, `bun run check` all pass.

## Documentation updates

- None. Subspec 07 covers docs.
