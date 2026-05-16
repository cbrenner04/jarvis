# 02 — Self-review phase with `plan: review N` commits

## Problem

After the `plan: draft` commit lands, plan mode runs N self-review
passes (default 2). Each pass is a single agent invocation that
re-reads `intent.md` plus the current spec files and re-edits them in
place. Each pass that produces changes is committed as `plan: review
N` (1-indexed) and pushed before the next pass begins.

## Decisions

- **Pass count.** Read `--review-passes` from the parsed invocation
  (skeleton spec already parsed it). Default `2` when unspecified.
  `0` skips the phase entirely. Negative values are already rejected
  by the parser.
- **Pass numbering.** 1-indexed in commit subjects: `plan: review 1`,
  `plan: review 2`, ...
- **Per-pass agent invocation.** Same agent-spawn helper as the draft
  phase. Prompt template: `src/modes/plan/prompts/review.md`. The
  prompt:
  - Inlines `intent.md` (re-read each pass; the user may have edited
    it between commits).
  - Inlines `docs/spec-guidance.md`.
  - Lists every file currently under `spec/<name>/` and inlines their
    contents (including `index.md`).
  - Tells the agent: critique the current spec against intent and
    guidance; rewrite files in place to address the most important
    issues; do not modify `intent.md`; do not delete `index.md`; do
    not commit; do not push.
  - Notes that the agent **may** add or remove subspec files (and
    must update `index.md` to match).
- **Empty pass handling.** If a pass produces no working-tree changes,
  do **not** create a commit. Skip to the next pass (or to PR-open if
  no more passes remain). Print one stderr line: `plan: review <N>:
  no changes`.
- **Per-pass validation.** After each pass that produces changes,
  re-run the same validation as the draft phase: `index.md` exists,
  parses, links to existing subspec files, and `intent.md` is
  unchanged. Validation failure exits `1`; the bad changes are left
  uncommitted in the worktree for inspection.
- **Per-pass commit body:**

  ```text
  Reviewed by <agent-attribution>.
  ```

  Single line. The previous spec's `plan: draft` body included a
  subspec count; review commits do not, since callers can `git diff`
  to see structural changes if needed.
- **Push cadence.** Each `plan: review N` commit is pushed
  immediately. PR remains draft.
- **Quota fallback applies per pass.** If pass N's first-choice agent
  hits quota, fall over to the next agent in order for that pass.
  Agent attribution in the commit body reflects the agent that
  actually completed the pass. Different passes can be completed by
  different agents.
- **No agent rotation strategy.** We do not rotate agents across
  passes for diversity; each pass starts at the top of the order.
  Quota fallback is the only reason a non-first-choice agent runs.

## Implementation hints

- Pull "snapshot all spec files into a string for prompt injection"
  into a small helper; both draft validation and review prompt
  assembly need to read the spec tree.
- Use `git status --porcelain` (already used by patch mode in
  `src/modes/patch/run.ts`) to detect whether a pass produced
  changes.
- The per-pass loop slots into `planCommand` in `src/commands/plan.ts`
  between the draft-phase agent call (subspec 01) and `ensureDraftPr`.
  Each iteration: build prompt, spawn agent (reusing the patch-mode
  agent classes via `runAgent`), validate, optionally commit + push
  via the `commitWithTrailer`/`pushCurrent` primitives that the
  existing `commitPlanDraft`/`commitPlanInterview` already use.

## Tasks

- [ ] Add `src/modes/plan/prompts/review.md`.
- [ ] Add `buildReviewPrompt` helper.
- [ ] Implement the per-pass loop in `planCommand` between the draft
  phase and PR-open.
- [ ] Implement empty-pass detection and skip logic.
- [ ] Implement per-pass validation and exit-1 path.
- [ ] Wire in per-pass quota fallback.
- [ ] Tests:
  - Stub agent that always edits `index.md` → 2 review commits land
    by default; `--review-passes 3` lands 3.
  - `--review-passes 0` skips the phase entirely.
  - Stub agent that produces no changes → no commit for that pass;
    stderr message printed.
  - Stub agent that modifies `intent.md` → exit `1`, no commit, error
    names the violation.
  - Stub agent that produces malformed `index.md` → exit `1`, no
    commit.
  - Per-pass quota fallback: first agent hits quota, second
    completes the pass; commit attribution is the second agent.
  - All agents quota-exhausted on a pass → existing exit
    code/message; prior commits remain.

## Acceptance criteria

- [x] After draft, `--review-passes` (default 2) review passes run,
  each producing at most one `plan: review N` commit.
- [x] Empty passes are skipped without committing.
- [x] Validation failures exit `1` and leave the worktree for
  inspection.
- [x] Per-pass quota fallback works.
- [x] `intent.md` is never modified by the review phase (validated).
- [x] `bun run typecheck`, `bun test`, `bun run check` all pass.

## Documentation updates

- None. Subspec 04 covers docs.
