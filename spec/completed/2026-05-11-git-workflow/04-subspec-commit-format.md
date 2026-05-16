# 04 - Subspec commit format

## Problem

Each completed subspec must produce exactly one commit with a deterministic,
self-contained message.

## Bootstrap

This subspec has a chicken-and-egg problem: the run loop does not yet commit
or push between iterations, so a normal `jarvis run` of this subspec will
end the iteration with a dirty worktree and exit 6 before the next subspec
can be picked up. To bootstrap:

- Implement the tasks below in a single agent iteration *without relying on*
  the loop to commit. Leave the worktree dirty as usual.
- The human operator then manually commits and pushes the result, flipping
  the `04` checkbox in `index.md` as part of that commit (matching the
  commit shape this subspec defines: H1 subject, `Spec:` body line,
  acceptance section).
- From subspec `05` onward, the loop is self-sustaining — every subsequent
  iteration commits and pushes itself.

This is a one-time exception to the "jarvis creates the commit" rule in
`AGENTS.md`, justified because the rule itself is the thing being
implemented. Document the one manual commit in the PR description.

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
- [ ] Wire `commitSubspec` into the run loop in `src/commands/run.ts`. After
  each agent iteration:
  1. Snapshot the `- [ ]` / `- [x]` state of the `index.md` checklist
     *before* invoking the agent.
  2. After the agent returns, re-read `index.md` and identify entries that
     transitioned from `[ ]` to `[x]`.
  3. For each newly-checked entry, resolve its linked path and call
     `commitSubspec(<path>)`. Pair with `pushCurrent()` per subspec 06.
- [ ] If an iteration produces no checklist transition but does dirty the
  worktree, surface it as a blocker (do not silently leave changes
  uncommitted). The current exit-6 path remains the safety net.
- [ ] If a single iteration flips more than one checkbox, fail with a clear
  error: the harness contract is one subspec per iteration.

## Acceptance criteria

- Completing one subspec produces exactly one commit whose subject matches
  the subspec H1.
- The same commit includes the index.md checkbox flip.
- `git log -1 --format=%B` shows the spec path on the first body line and
  the acceptance criteria below it.
- After every iteration of a real `jarvis run`, the worktree is clean
  (verified by `git status --porcelain` returning empty).
- A regression test drives the run loop end-to-end against a fixture spec
  with two subspecs and asserts two commits land in order, each clean.

## Docs

- Add a "commit shape" subsection under the README git-workflow docs.
