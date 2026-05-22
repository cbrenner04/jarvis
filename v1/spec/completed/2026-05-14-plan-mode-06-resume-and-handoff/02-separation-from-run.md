# 02 — Strict separation from `jarvis run` and next-step hint

## Problem

Per `AGENTS.md`, specs must be merged to `main` before any
implementation work begins. Plan mode produces draft PRs with spec
files; without explicit guidance, a user might be tempted to run
`jarvis run` against the spec while it still lives on the
unmerged plan branch. We codify the separation in two ways:

1. A clear "next steps" block printed at the end of every successful
   plan-mode invocation, pointing the user at the PR and showing the
   exact `jarvis run` command to use *after* merging.
2. A non-blocking warning in `jarvis run` when its target spec
   appears to be on a `plan/*` branch in the project.

## Decisions

- **Plan-mode "next steps" block.** Printed to stdout (not stderr)
  immediately before exit `0`, after the PR URL line. Multi-line:

  ```text

  Next steps:
    1. Review the draft PR: <pr-url>
    2. Edit spec/<name>/ on the plan branch as needed (locally or
       through GitHub), or run `jarvis plan --resume
       spec/<name>/index.md` for another self-review pass.
    3. Mark the PR ready for review and merge it to main.
    4. After the merge, implement the spec with:
         jarvis run spec/<name>/index.md
  ```

  The block is omitted when plan mode exits non-zero (blocker, quota,
  Ctrl-C, validation failure) — those exit paths already print
  enough context.
- **Run-mode plan-branch warning.** When `jarvis run` is invoked, it
  performs a small additional preflight: in the target project's main
  checkout, run `git ls-remote --heads origin plan/*` and check
  whether any of those branch names map to the spec being run. The
  spec-name extraction from the spec path uses the same logic resume
  does (`<spec-path>` → `<name>`).
  - If a `plan/<name>` branch exists on origin **and** is not yet
    merged into the default branch (`git merge-base --is-ancestor
    origin/plan/<name> origin/<default-branch>` returns false), print
    a warning to stderr:

    ```text
    warning: a plan branch plan/<name> exists on origin and has not
    been merged. Run `jarvis run` after merging the plan PR to avoid
    drift between the spec on disk and the merged spec.
    ```

    Then proceed with the run. Do **not** block.
  - If the merge-base check shows the plan branch is merged, no
    warning. (Common case: the user merged the plan PR but
    `jarvis cleanup` hasn't run yet.)
  - If `git ls-remote` fails (network, auth), skip the check
    silently. This preflight should never block run.
- **No new commands or flags** are added.
- **Plan mode never marks PR ready.** This was already documented in
  `spec/2026-05-14-plan-mode-worktree-and-commits/05-draft-pr.md`. This subspec
  asserts it via a test that exercises the full plan-mode happy path
  and checks that no `gh pr ready` invocation occurs.

## Implementation hints

- The plan-branch check in `jarvis run` is best done in the same
  preflight area where the existing log-server, repo-resolution, and
  worktree-state checks already live. Add it last so it runs after
  cheaper checks.
- `git merge-base --is-ancestor` returns exit code `0` if true and
  `1` if false; treat anything else as "skip the check."

## Tasks

- [x] Implement the "Next steps" block printer; wire it into the
  successful exit path of `planCommand` (initial and resume).
- [x] Add the plan-branch warning preflight to `jarvis run`.
- [x] Add a test asserting plan mode never invokes `gh pr ready`.
- [x] Tests:
  - Successful plan run prints the next-steps block with the right
    PR URL and `<name>`.
  - Failed plan run (blocker stub) does not print the next-steps
    block.
  - `jarvis run` against a spec whose `plan/<name>` branch exists
    unmerged on origin → warning printed; run proceeds.
  - `jarvis run` against a spec whose `plan/<name>` branch is merged
    → no warning.
  - `jarvis run` against a spec with no corresponding `plan/<name>`
    branch → no warning.
  - `git ls-remote` failure → no warning, no run-blocking error.

## Acceptance criteria

- [x] Plan-mode successful exits print the documented "Next steps"
  block.
- [x] Plan-mode never invokes `gh pr ready`.
- [x] `jarvis run` prints a warning when its spec corresponds to an
  unmerged `plan/<name>` branch on origin, but does not block.
- [x] The preflight skips silently on network/auth failure.
- [x] `bun run typecheck`, `bun test`, `bun run check` all pass.

## Documentation updates

- None. Subspec 03 covers docs.
