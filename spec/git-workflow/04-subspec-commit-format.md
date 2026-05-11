# 04 - Subspec commit format

## Problem

Each completed subspec must produce exactly one commit with a deterministic,
self-contained message.

## Decisions

- Commit subject = the subspec's H1 (the first `# ` heading), verbatim.
- Commit body =
  - first line: `Spec: <relative path to subspec from repo root>`
  - blank line
  - the verbatim `## Acceptance criteria` section of the subspec
- No `Co-Authored-By` trailer in this spec. (Can be revisited later.)
- The same commit also flips the index.md checkbox for that subspec from `[ ]`
  to `[x]`. The index update is staged together with the work.
- One subspec → one commit. If a subspec touches multiple concerns, that is a
  signal to split it before running, per `docs/spec-guidance.md`.

## Tasks

- [ ] Implement `commitSubspec(subspecPath)` that:
  1. Parses subspec H1 and `## Acceptance criteria` block.
  2. Flips the matching `- [ ]` to `- [x]` in the spec's `index.md`.
  3. Stages all changes in the worktree (`git add -A`).
  4. Commits via HEREDOC to preserve formatting.
- [ ] Refuse to commit if the H1 is missing or the acceptance section is
  absent — surface as a blocker per subspec 07.

## Acceptance criteria

- Completing one subspec produces exactly one commit whose subject matches the
  subspec H1.
- The same commit includes the index.md checkbox flip.
- `git log -1 --format=%B` shows the spec path on the first body line and the
  acceptance criteria below it.

## Docs

- Add a "commit shape" subsection under the README git-workflow docs.
