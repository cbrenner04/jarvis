# 07 - Pre-commit hook and blocker handling

## Problem

Verification failures, hook failures, and ambiguous subspecs need a single,
auditable failure mode that matches the existing Jarvis blocker convention.

## Decisions

- Blocker convention (per `AGENTS.md`): append a `## Blocker` section to the
  active subspec describing what is unclear or what failed, then stop.
- Pre-commit hook failure → blocker. Never pass `--no-verify`. Never amend.
- Subspec verification failure (acceptance criteria not met) → blocker.
- On blocker:
  1. Append the `## Blocker` section to the subspec.
  2. Stage and commit whatever progress exists, using the normal commit
     format from subspec 04 but with subject prefixed `WIP: ` and **without**
     flipping the index checkbox.
  3. Push (per subspec 06).
  4. Exit non-zero with a message pointing at the subspec.
- Resume after a blocker: user edits the subspec to resolve ambiguity or
  fixes the underlying issue, then re-runs Jarvis. Subspec 02's resume rules
  pick up the same branch/PR.

## Tasks

- [ ] Detect pre-commit hook exit codes and route into the blocker path.
- [ ] Implement `recordBlocker(subspecPath, reason)` that appends the
  section idempotently (do not duplicate an existing `## Blocker`).
- [ ] Implement the WIP-commit + push variant for blocker state.

## Acceptance criteria

- A failing hook leaves the worktree with: (a) a `## Blocker` section on the
  active subspec, (b) a `WIP:`-prefixed commit pushed, (c) the index
  checkbox still unchecked.
- Re-running after resolving the blocker continues from the next subspec
  without manual branch surgery.

## Docs

- Cross-link from the README git-workflow section to `AGENTS.md` blocker
  rules.
