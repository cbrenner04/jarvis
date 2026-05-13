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
- **Uniqueness check.** After deriving the candidate name, check both:
  - `<projectRoot>/spec/<name>/` exists in the working tree of the
    project's main checkout (we read from disk, not from git history).
  - `<projectRoot>/.worktree/plan-<name>/` exists.
  If either exists, append `-2`, `-3`, ... until both are free. The
  same suffix must apply to both checks; never end up with `spec/foo-2`
  but `.worktree/plan-foo-3`.
- **Branch-name collision** is handled implicitly: the suffix flows
  through to the branch name as `plan/<name-with-suffix>`. We do not
  separately check `git ls-remote` for branch existence in this spec;
  if a remote `plan/<name>` exists for some reason, `git worktree add
  -b` will fail, and that surfaces through subspec 01's error path.
  This is acceptable for the skeleton stage; agent-proposed naming will
  revisit.
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

## Tasks

- [ ] Implement `deriveSpecName` with the rules above.
- [ ] Wire it into `planCommand` between repo resolution and worktree
  creation (subspec 01 then receives the chosen name).
- [ ] Tests:
  - File mode: various basenames produce the expected kebab-case.
  - Inline mode: long text is truncated to 6 words / 40 chars.
  - Empty / all-punctuation input falls back to `plan`.
  - Reserved names (`index`, `intent`) trigger the fallback.
  - Existing `spec/<name>/` directory triggers `-2` suffix; both name
    and worktree path agree on the suffix.
  - Both `spec/<name>/` and `.worktree/plan-<name>/` existing requires
    going to `-3` (or higher) to satisfy both.

## Acceptance criteria

- [ ] `<name>` is derived deterministically from file or inline input
  per the rules above.
- [ ] Collisions with existing `spec/<name>/` or
  `.worktree/plan-<name>/` directories are resolved by suffixing.
- [ ] Interactive mode continues to hit the skeleton stub exit (no
  derivation attempted).
- [ ] No agent is invoked.
- [ ] `bun run typecheck`, `bun test`, `bun run check` all pass.

## Documentation updates

- None. Subspec 07 covers docs.
