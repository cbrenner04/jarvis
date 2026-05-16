# 03 — Agent-proposed spec name with worktree rename

## Problem

Spec names have been derived deterministically since
`spec/2026-05-14-plan-mode-worktree-and-commits/02`. The agent has more context
than a regex: after the interview, it knows what the spec is *about*
and can pick a meaningful kebab-case name. Replace the deterministic
derivation with an agent-proposed name, while preserving the
uniqueness/auto-rename behavior.

The bootstrap problem (worktree path includes `<name>` but the agent
needs a worktree to propose `<name>` in) is solved with a temporary
worktree that gets renamed once the agent picks a name.

## Decisions

- **Two-stage worktree.**
  - Initial creation uses path
    `<projectRoot>/.worktree/plan-tmp-<short-uuid>/` on branch
    `plan/tmp-<short-uuid>`. `<short-uuid>` is the first 8 chars of
    a v4 UUID.
  - The temporary branch is **never pushed**. All pushes happen after
    rename.
- **Naming hook.** The interview-phase prompt
  (`src/modes/plan/prompts/interview.md`) is updated:
  - On the **final** turn (the one where the agent decides the
    interview is complete, signaled by no `question` tool call and a
    final `intent.md` write), the agent must include a `name:
    <kebab-case>` line in a leading block at the top of `intent.md`,
    e.g.:

    ```md
    ---
    name: csv-report-export
    ---

    # Intent
    ...
    ```

  - The agent must propose a kebab-case name (lowercase
    `[a-z0-9-]+`), reasonably short (≤ 40 chars), descriptive of the
    intent.
  - Reserved names (`index`, `intent`, anything the deterministic
    helper rejected) are rejected; the agent is told the rule.
- **Naming-only path** (when interview is skipped via
  `--interview-turns 0` for file/inline modes): a single agent
  invocation runs with a stripped-down "naming-only" prompt
  (`src/modes/plan/prompts/name-only.md`) that injects the seeded
  `intent.md` and asks only for the `name: <kebab-case>` frontmatter
  line. Validation, fallback, and the rename flow are otherwise
  identical.
- **Validation.** After the interview (or naming-only) phase, plan
  mode reads `intent.md` and:
  - Looks for a `name:` line inside the leading frontmatter block.
  - If absent or invalid (bad chars, reserved, too long), fall back
    to the deterministic derivation from
    `spec/2026-05-14-plan-mode-worktree-and-commits/02-spec-name-proposal.md`
    and print one stderr line: `plan: agent did not propose a valid
    name; falling back to deterministic derivation (<derived>)`.
  - If present and valid, run the candidate through the uniqueness
    suffix loop to pick the final name.
- **Rename sequence.** Once the final name is chosen:
  1. `git -C .worktree/plan-tmp-X branch -m plan/<name>`.
  2. `git worktree move .worktree/plan-tmp-X .worktree/plan-<name>`.
  3. Delete the orphaned temp branch reference (if any) with `git
     branch -D` against any leftover symbolic refs; usually a no-op
     after `branch -m`.
  4. From the renamed worktree, do the **first** push as `git push -u
     origin plan/<name>`.
  5. Then create and push the `plan: interview` commit (which
     includes the `name:` frontmatter that drove the decision).
- **PR opens against the final branch.** The PR-open step from
  `spec/2026-05-14-plan-mode-worktree-and-commits/05` already runs against the
  current branch name; after rename it sees `plan/<name>`, so no
  change to that step is needed beyond confirming order: rename →
  first push → interview commit + push → draft commit + push → PR
  open.
- **`<name>` is read from `intent.md`** at every later step that
  needs it (commit messages, PR title, validation paths). The
  parsed-frontmatter result is the source of truth; we do not stash
  `<name>` in process state alone.
- **Rename failure handling.** If `git worktree move` or `branch -m`
  fails (very rare; usually only when a half-broken state from a
  prior crashed run is present), exit `1` with the git error
  verbatim. The temp worktree and branch are left for the user to
  resolve manually with `git worktree remove` / `git branch -D`. We
  do not try to roll back; the user always has more context than we
  do at this point.
- **Frontmatter is preserved through later phases.** Draft and
  self-review prompts must explicitly tell the agent not to touch
  the leading `---` frontmatter block in `intent.md`. Validation in
  those phases (already added in
  `spec/2026-05-14-plan-mode-draft-and-review/`) considers a modified
  frontmatter a violation.

## Implementation hints

- A `parseIntentFrontmatter(text): { name?: string; rest: string }`
  helper keeps `intent.md` reading uniform.
- `git worktree move` requires the destination to not exist; the
  uniqueness loop already guarantees that before we attempt the
  rename.

## Tasks

- [ ] Add `parseIntentFrontmatter` helper and a
  `validateProposedName` helper (kebab-case + reserved-name rules).
- [ ] Update `src/modes/plan/prompts/interview.md` to include the
  naming instructions and frontmatter format.
- [ ] Add `src/modes/plan/prompts/name-only.md` for the
  `--interview-turns 0` file/inline path.
- [ ] Switch initial worktree creation to the temp-name form.
- [ ] Implement the post-interview rename sequence.
- [ ] Update the deterministic-name fallback path with the documented
  stderr message.
- [ ] Update draft and review prompts to declare the frontmatter
  off-limits; update validation to reject frontmatter modifications.
- [ ] Tests:
  - Interview ends with `name: foo` → worktree renamed to
    `.worktree/plan-foo`, branch renamed to `plan/foo`, first push
    uses `-u`, PR opened against `plan/foo`.
  - Interview ends with `name: foo` but `spec/foo/` already exists
    → final name is `foo-2`; worktree, branch, and spec dir all
    align.
  - Interview ends without a `name:` line → deterministic fallback
    used; stderr message printed; rename and pushes still happen.
  - Interview proposes a reserved name (`index`) → fallback used.
  - File mode + `--interview-turns 0` → naming-only prompt runs;
    agent proposes a valid name; rename happens.
  - File mode + `--interview-turns 0` + agent fails to propose →
    deterministic fallback; rename happens.
  - Draft phase modifies frontmatter → exit `1` with the
    frontmatter-violation message.
  - `git worktree move` failure → exit `1`, temp state remains for
    user.

## Acceptance criteria

- [ ] Spec names are agent-proposed by default, with
  deterministic-fallback parity when the agent declines or proposes
  invalid input.
- [ ] Worktree and branch names are renamed atomically (from the
  user's perspective) before any push to origin.
- [ ] `intent.md` carries the chosen `name:` in a leading
  frontmatter block; later phases must not touch it.
- [ ] Uniqueness suffix loop still applies.
- [ ] `bun run typecheck`, `bun test`, `bun run check` all pass.

## Documentation updates

- None. Subspec 04 covers docs.
