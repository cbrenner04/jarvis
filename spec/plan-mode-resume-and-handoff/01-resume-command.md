# 01 — `--resume` command

## Problem

`jarvis plan --resume <spec-path>` lets users iterate on a plan PR
after reviewing it: maybe they edited the spec files locally, maybe
they updated `intent.md`, maybe they just want another self-review
pass with a different agent. Resume re-runs the self-review phase
(and optionally the interview phase) against the existing worktree.

## Decisions

- **Invocation shape.** `jarvis plan --resume <spec-path> [--review-passes N] [--interview-turns N]`.
  - `<spec-path>` is required when `--resume` is set; reject usage
    without it (exit `1`, message `--resume requires a spec path`).
  - `--repo`, `--cwd` are accepted (to drive target-repo resolution),
    but no positional intent text or intent file is allowed (reject
    with exit `1` and `--resume cannot be combined with intent
    text/file`).
- **Spec path interpretation.** Only `spec/<name>/index.md` is
  accepted. Mirrors `jarvis run`, which also operates only on
  `index.md`. Passing any other file (including `intent.md`,
  `00-task.md`, etc.) exits `1` with `--resume requires an index.md
  path; got <provided-path>`. `<name>` is the parent directory
  segment.
- **Preflight order:** parse → resolve repo → log-server check →
  validate the resume target:
  - `<projectRoot>/.worktree/plan-<name>/` exists and is a worktree
    on branch `plan/<name>`.
  - `<projectRoot>/spec/<name>/index.md` and `intent.md` both exist
    inside the worktree.
  - The worktree is **clean** (no unstaged changes). If dirty, exit
    `1` with the same advice patch mode uses (point at `jarvis
    triage`).
  - The remote branch exists (`git ls-remote --exit-code origin
    plan/<name>`). If it does not, exit `1` with `plan branch
    plan/<name> is not on origin; cannot resume`.
- **Counter computation.** Compute the next resume invocation number
  by reading `git log` on `plan/<name>` and counting how many
  existing commit subjects match `^plan: (interview|review \d+|blocker) r(\d+)$`,
  taking the max `r<n>` and adding 1. If no `r<n>` commits exist,
  start at `r1`. Compute the next review-pass-number similarly:
  count subjects matching `^plan: review \d+( r\d+)?$`, max + 1.
- **Phase ordering inside resume:**
  1. If `--interview-turns N > 0`, run the interview phase exactly
     as the initial invocation does, but writing turns into
     `intent.md` continuing the numbering, and committing as
     `plan: interview r<n>`. Push.
  2. Run `--review-passes N` self-review passes (default 2). Each
     pass that produces changes is committed as `plan: review <K>
     r<n>` with K being the next overall review pass number. Push
     each.
  3. Stop conditions, blocker handling: same as initial.
- **Empty resume.** `--review-passes 0` and no `--interview-turns`
  flag is rejected (exit `1` with `--resume requires at least one
  phase`). Interview-only resume (`--interview-turns 1
  --review-passes 0`) is allowed.
- **No worktree creation, no PR creation.** Both already exist; reuse
  the existing PR (the existing idempotence in subspec 05 of
  worktree-and-commits handles re-finding it).
- **Stderr boundary lines.** Print `plan mode: resume r<n> started`
  at entry and `plan: complete (resume r<n>)` at clean exit so logs
  are easy to scan.

## Implementation hints

- A `prepareResume({ projectRoot, specPath })` helper centralizes
  validation and returns `{ name, worktreePath, nextResumeIndex,
  nextReviewIndex }`.
- Counter parsing is fragile if subject formats drift; keep it in
  one regex constant shared with the writer side so any subject
  format change must update both.

## Tasks

- [ ] Implement `prepareResume` with all preflight validation.
- [ ] Wire `--resume` dispatch in `planCommand`.
- [ ] Implement counter computation from `git log`.
- [ ] Reuse interview and review-loop helpers from prior specs,
  parameterizing the commit-subject formatter to add the `r<n>`
  suffix and the per-pass index.
- [ ] Reject invalid combinations (`--resume` with intent text;
  `--review-passes 0` without interview turns; missing
  `<spec-path>`; non-`index.md` path including `intent.md` or any
  subspec file).
- [ ] Tests:
  - Existing worktree + PR; `jarvis plan --resume spec/x/index.md`
    runs 2 review passes, commits as `plan: review N r1`, pushes
    each, exits `0`.
  - Same scenario with `--review-passes 3` produces 3 commits.
  - With `--interview-turns 2 --review-passes 1`, interview runs
    first (`plan: interview r1`), then 1 review pass.
  - `--review-passes 0` with no interview flag → exit `1`.
  - `--resume` with no spec path → exit `1`.
  - `--resume` with intent text → exit `1`.
  - Worktree missing → exit `1` with the documented message.
  - Worktree dirty → exit `1` with `jarvis triage` advice.
  - Remote branch missing → exit `1` with the documented message.
  - Second resume invocation correctly uses `r2` and continues
    review-pass numbering.
  - Blocker raised during resume → `plan: blocker r<n>` commit; exit
    `1`.

## Acceptance criteria

- [ ] `jarvis plan --resume <spec-path>` runs additional self-review
  passes against an existing plan worktree.
- [ ] Resume commit subjects carry an `r<n>` suffix that increments
  per resume invocation.
- [ ] Validation rejects all documented invalid combinations.
- [ ] Resume reuses the existing draft PR.
- [ ] Blocker, quota, and Ctrl-C handling match initial invocation.
- [ ] `bun run typecheck`, `bun test`, `bun run check` all pass.

## Documentation updates

- None. Subspec 03 covers docs.
