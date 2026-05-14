# Plan mode — resume and run handoff

repo: git@github.com:cbrenner04/jarvis.git

Final plan-mode spec. Implements `--resume`, formalizes the strict
separation between plan and run modes, and lands a final documentation
pass that consolidates everything.

After this spec merges, plan mode is feature-complete per the design:

- Three input modes (file, inline, interactive) work end-to-end.
- Interview → draft → self-review → pause-for-PR runs cleanly.
- Stop conditions and blockers are handled.
- Users can iterate on a plan PR with `jarvis plan --resume <spec-path>`
  to run additional self-review passes after editing.
- The "merge spec PR to `main` before running implementation" rule is
  enforced socially through user-visible guidance and a printed
  next-step hint.

## Decisions

- **Depends on `spec/plan-mode-interview/` being merged.**
- **`--resume` was parsed by the skeleton spec** but inert until now.
  This spec wires real behavior:
  - `jarvis plan --resume <spec-path>` is the only valid resume form.
    `<spec-path>` must point at an existing `spec/<name>/index.md`.
    Other paths (including `intent.md` or subspec files) are
    rejected. This mirrors `jarvis run`, which also operates only on
    `index.md`.
  - File path → `<name>` extraction is from the path's last directory
    segment. Validation: `index.md` and `intent.md` both exist; the
    branch `plan/<name>` and worktree `.worktree/plan-<name>/` exist
    locally; the branch is checked out in the plan worktree.
  - Resume runs `--review-passes N` additional self-review passes
    against the existing worktree (default 2; same flag).
  - **No new interview turns** by default. If `--interview-turns N` is
    also passed (with N > 0), an interview phase runs first, just like
    initial invocation, and any new turns are appended to `intent.md`
    as additional `## Interview turn <N>` sections (continuing the
    numbering).
  - **No `--repo` / no positional intent.** Resume operates entirely
    from the existing worktree's state.
- **Resume commit subjects use a `r<n>` suffix** to distinguish a
  resume pass from the original passes. Numbering: if the original
  PR has 2 review commits (`plan: review 1`, `plan: review 2`),
  resume's first pass is `plan: review 3 r1`, second is `plan: review
  4 r1`, and a *second* resume run that adds two more passes is
  `plan: review 5 r2`, `plan: review 6 r2`. The body still includes
  the agent attribution. The `r<n>` counter increments per resume
  invocation, not per pass.
- **Resume interview commits** (when `--interview-turns N` is passed)
  use subject `plan: interview r<n>` with body:

  ```text
  Resumed by <agent-attribution>.
  Turns: <new-turn-count>
  ```

  And carry the standard push behavior.
- **Stop conditions during resume** are identical to initial
  invocation: clean completion, Ctrl-C, quota, blocker. A blocker
  raised during resume produces a `plan: blocker r<n>` commit with the
  same exit/print behavior.
- **PR remains draft.** Resume never marks the PR ready. The body
  remains the fixed template.
- **No PR re-creation.** Resume reuses the existing draft PR.
  (Idempotent reuse is already handled by
  `spec/plan-mode-worktree-and-commits/05-draft-pr.md`.)
- **Strict separation from `jarvis run`.** Plan mode never invokes
  run mode. Plan-mode PRs must be merged to `main` before any
  `jarvis run` is started. We make this explicit by:
  - Printing a final "next steps" block at the end of every
    successful plan-mode invocation that points at the PR URL,
    explains the merge-first rule, and shows the exact `jarvis run`
    command to use after merging.
  - Adding a guard in `jarvis run` that detects when its target spec
    appears to be on a `plan/*` branch in the project's git state and
    prints a warning before proceeding (does not block; warns).
- **Documentation pass.** All forward references to unimplemented
  behavior are removed; `docs/plan-mode.md` is finalized; the README
  carries a clean, current description.

## Subspecs

> **Preflight (do not skip):** before starting subspec 01, verify the
> interview spec is on `main` by running `jarvis plan` (no args) and
> confirming the interview phase prompts for input via the `question`
> tool and that the resulting PR contains an agent-proposed `<name>`.
> If interactive mode still hits the skeleton stub, the prior spec has
> not landed — stop and resolve before continuing.

- [ ] [01 — `--resume` command](./01-resume-command.md)
- [ ] [02 — Strict separation from `jarvis run` and next-step hint](./02-separation-from-run.md)
- [ ] [03 — Final documentation pass](./03-final-docs-pass.md)

## Conventions

- Run this spec with `jarvis run spec/plan-mode-resume-and-handoff/index.md`.
- Complete one subspec per iteration. Do not bundle.
- If a subspec is blocked, append a `## Blocker` section to that file and
  stop.

## Non-goals

- Implementing any "auto-handoff" from plan to run. The merge-first
  rule is the gate.
- Adding plan-mode behavior beyond resume; the design is complete with
  this spec.
- Editing the PR body or title. Plan-mode PRs keep the fixed template.
