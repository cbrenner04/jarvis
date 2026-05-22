# 02 — Git, GitHub, worktrees, and attribution

## Problem

V1's operator-facing behavior is tightly coupled to git worktrees, branch
naming, draft PR creation, commit trailers, and GitHub CLI mediation. Those
behaviors are visible to users and reviewers even when they are implemented
across several modules, so the catalog needs a dedicated source audit for them.

## Scope

Fully author the `## Git/GitHub behavior` section in
`v2/spec/v1-behaviors.md`.

Add entries to `## Behaviors with uncertain intent` or
`## Surprising or possibly vestigial behaviors` only when this audit uncovers a
behavior that belongs there more naturally than in the Git/GitHub section.

This slice should fill the existing section shape rather than broadening the
catalog outline. Plan-mode-specific git behaviors belong here only when they
are observable through worktrees, commits, PRs, or PR bodies.

## Primary sources

- `v1/src/pr.ts`
- `v1/src/gh.ts`
- `v1/src/worktree.ts`
- `v1/src/worktree-lock.ts`
- `v1/src/commit-trailer.ts`
- `v1/src/modes/patch/pr.ts`
- `v1/src/modes/plan/pr.ts`
- `v1/docs/worktrees-and-commits.md`
- `v1/docs/plan-mode.md`

## Task checklist

- [ ] Audit source-first how v1 creates, reuses, and cleans up worktrees and
      branches for implementation and plan flows.
- [ ] Document user-visible lock behavior from `v1/src/worktree-lock.ts`,
      including how stale or conflicting locks surface to operators if they
      block progress.
- [ ] Organize the section with stable subsections that separate worktree and
      lock behavior, branch and commit behavior, PR/GitHub CLI behavior, and
      attribution/footer behavior.
- [ ] Capture PR behavior, including draft PR creation timing, base-branch
      assumptions, the role of the GitHub CLI wrapper, and any meaningful
      differences between patch-mode and plan-mode PR handling.
- [ ] Document commit-message and trailer behavior that surfaces in history or
      PR attribution, including `Jarvis-Agent` trailers and the per-commit plus
      summary attribution footer behavior.
- [ ] Include the plan-mode PR lifecycle details that are owned by these git/PR
      modules rather than by the higher-level plan prompts, especially the
      collapse of consecutive meta-commits in attribution output.
- [ ] If this audit finds behaviors that look user-visible but possibly
      accidental or vestigial, record them in the dedicated catalog sections
      with source-backed context.

## Acceptance criteria

- [ ] `v2/spec/v1-behaviors.md` contains a substantive `## Git/GitHub behavior`
      section covering worktrees, branch/worktree naming, PR creation/update
      behavior, commit/trailer behavior, and attribution footers.
- [ ] The section is organized with clearly named subsections for worktrees and
      locks, branches and commits, PR/GitHub CLI behavior, and attribution.
- [ ] The section includes source-backed catalog entries for worktree locking
      and for the GitHub CLI mediated behaviors implemented through `v1/src/gh.ts`.
- [ ] The section captures plan-mode-specific PR lifecycle details that are
      observable through git history or PR bodies, including attribution
      collapsing for meta-commits where supported by source.
- [ ] Every behavior entry added by this subspec cites at least one supporting
      source file.
- [ ] Any ambiguity called out by this subspec is tagged `[uncertain]` and
      includes a brief explanation of the unresolved evidence gap.

## Documentation updates

- [ ] `v2/spec/v1-behaviors.md` is updated for the Git/GitHub behavior area
      owned by this subspec.
