# Plan mode — worktree, branch, commits, and draft PR

repo: git@github.com:cbrenner04/jarvis.git

Land the git-side machinery for plan mode: a dedicated worktree slot
(`.worktree/plan-<name>/`) on a `plan/<name>` branch, an empty
`spec/<name>/intent.md` seeded into the worktree, two phase-marker
commits (`plan: interview` and `plan: draft`) with placeholder content,
and a draft PR opened after the `plan: draft` commit. **No agent calls
yet** — every commit body in this spec is placeholder text.

After this spec merges, `jarvis plan <intent-file>` produces a real
draft PR on a real branch with a placeholder spec tree the user can
inspect end-to-end. The `plan-mode-draft-and-review/` spec then replaces
the placeholder content with real agent-generated specs.

## Why this spec is intentionally inert

Worktree, branch, and PR machinery is the riskiest part of plan mode
operationally — it touches the user's git state, opens PRs against their
GitHub repo, and runs `gh`. Landing it without any agent involvement
keeps the diff focused on git semantics and lets reviewers verify the
mechanical behavior in isolation. Once this spec merges, every later
plan-mode spec only has to worry about content, not plumbing.

## Decisions

- **Depends on `spec/plan-mode-skeleton/` and
  `spec/cli-modes-and-config-v2/` being merged.** This spec assumes
  `jarvis plan` parses arguments via `parsePlanArgs`
  (`src/commands/plan-args.ts`), resolves the target repo and runs
  the log-server preflight via the shared `enterMode` helper
  (`src/mode-entry.ts`), and only then falls through to the
  `PLAN_STUB_MESSAGE` exit. The new code paths in this spec replace
  that stub exit; everything before it stays put.
- **Worktree slot:** `<projectRoot>/.worktree/plan-<name>/`.
  Distinct from patch-mode's `.worktree/<name>/` slot to prevent
  collisions when both modes target the same spec name.
- **Branch:** `plan/<name>`, created off the project's default branch
  (matching how patch-mode picks its base).
- **`<name>` source for this spec only:** derived deterministically.
  - File mode: kebab-cased basename of the intent file (without
    extension). Example: `~/notes/oauth login.md` → `oauth-login`.
  - Inline mode: kebab-cased first ~6 words of the inline text, capped
    at 40 characters. Example: `"add csv export to reports"` →
    `add-csv-export-to-reports`.
  - Interactive mode: this spec **does not run agents**, so interactive
    mode keeps falling through to the skeleton stub exit (`2`). Plan
    interactive sessions begin to do real work in
    `spec/plan-mode-interview/`. Document this in the README update.
  - Agent-proposed names replace this deterministic logic in
    `spec/plan-mode-interview/03-agent-proposed-spec-name.md`.
- **Collision handling:** if `spec/<name>/` already exists in the target
  repo (committed or in the worktree), append `-2`, `-3`, ... until
  free. Same loop for the worktree directory and branch name; all three
  must agree on the chosen suffix.
- **`intent.md` seed contents:**
  - File mode: copy the intent file verbatim into
    `spec/<name>/intent.md`.
  - Inline mode: write the inline text into `spec/<name>/intent.md`,
    followed by a single trailing newline.
- **Phase commits in this spec (placeholder content):**
  1. `plan: interview` — commits the seeded `intent.md` and nothing
     else. Commit body: one line, `Seeded from <file|inline>.`
  2. `plan: draft` — commits a placeholder `spec/<name>/index.md` and a
     placeholder `spec/<name>/00-task.md`. The placeholder `index.md`
     contains the H1 derived from `<name>` and a single unchecked
     checklist entry pointing at `00-task.md`. The placeholder
     `00-task.md` contains an explanatory note that real content lands
     in a later spec. Commit body: `Placeholder draft. Real content
     comes from spec/plan-mode-draft-and-review/.`
- **Push cadence:** push after each commit. First push uses `git push -u
  origin <branch>`; later pushes are plain `git push`. Same pattern as
  patch mode.
- **Draft PR:** opened after the `plan: draft` commit lands on the
  remote. Title `plan: <name>`. Body uses the same live-updating
  three-part shape patch mode uses (deterministic header + narrative
  markers + attribution footer rendered from `Jarvis-Agent` commit
  trailers); see subspec 05 for the plan-mode header. Always draft;
  never marked ready by jarvis (separation enforced in
  `spec/plan-mode-resume-and-handoff/`).
- **Cleanup integration:** `jarvis cleanup` should remove
  `.worktree/plan-<name>/` and the `plan/<name>` branch on the same
  conditions it removes patch worktrees (PR merged on origin). Subspec
  06 covers this.
- **No `--resume` handling** in this spec. The flag is parsed (skeleton
  did that) but ignored. Resume lands in the final spec.
- **No agent calls.** The agent factory is not exercised. Any test that
  would normally instantiate an agent should assert it is not called.

## Subspecs

> **Preflight (do not skip):** before starting subspec 01, verify the
> skeleton spec's behavior is on `main`: `jarvis plan --help` lists the
> command, `jarvis plan` exits `2` with the stub message, and
> `jarvis config show` includes explicit `modes.patch.agentOrder` and
> `modes.plan.agentOrder` entries. If any check fails,
> `spec/plan-mode-skeleton/` or `spec/cli-modes-and-config-v2/` has not
> landed yet — stop and resolve before continuing.

- [x] [01 — Worktree slot and branch creation](./01-worktree-and-branch.md)
- [x] [02 — Deterministic spec-name derivation](./02-spec-name-proposal.md)
- [x] [03 — Seed `intent.md` from file or inline input](./03-intent-file-skeleton.md)
- [x] [04 — Phase commits (`plan: interview`, `plan: draft`)](./04-commits-per-phase.md)
- [x] [05 — Draft PR open with live-updating body](./05-draft-pr.md)
- [x] [06 — Cleanup integration for plan worktrees](./06-cleanup-integration.md)
- [x] [07 — Documentation updates](./07-docs-updates.md)

## Conventions

- Run this spec with `jarvis run spec/plan-mode-worktree-and-commits/index.md`.
- Complete one subspec per iteration. Do not bundle.
- If a subspec is blocked, append a `## Blocker` section to that file and
  stop.

## Non-goals

- Any agent invocation. Real spec content arrives in
  `spec/plan-mode-draft-and-review/`.
- Interactive mode behavior. Stays at the skeleton stub until
  `spec/plan-mode-interview/` lands.
- Marking the PR ready for review. Plan mode never does this.
- Self-review passes (`plan: review N` commits). Those land in
  `spec/plan-mode-draft-and-review/`.
