# 05 — Draft PR open with live-updating body

## Problem

After the `plan: draft` commit lands on the remote, plan mode opens a
draft PR so reviewers can see the work in progress. The PR body uses
the same live-updating + per-commit attribution mechanism that landed
for patch mode, with a plan-mode-specific deterministic header. Plan
mode never marks the PR ready for review — that remains the human's
job after merging the spec PR into `main`. This separation becomes
load-bearing for the merge-first rule that
`spec/plan-mode-resume-and-handoff/` enforces.

## Decisions

- **When:** open the PR immediately after the `plan: draft` commit's
  push succeeds.
- **Tool:** reuse the patch-mode `ensureDraftPr` helper in `src/pr.ts`
  (the same one patch mode uses), passing plan-mode-specific inputs
  for the title and the deterministic header. The helper already
  handles `gh pr create --draft`, `gh pr view` idempotence, and the
  narrative-marker / attribution-footer assembly.
- **Title:** `plan: <name>`. No truncation; `<name>` is already short.
- **Body composition.** The same three-part body shape patch mode uses
  (deterministic header, agent-authored narrative bracketed by
  `<!-- jarvis:narrative:start -->` / `<!-- jarvis:narrative:end -->`,
  `Jarvis-Agent`-trailer-derived attribution footer):
  - **Deterministic header (rebuilt on every PR-body update):**

    ```md
    This PR was authored by `jarvis plan`. It contains a generated
    spec tree under `spec/<name>/` for human review.

    - Intent: `spec/<name>/intent.md`
    - Index: `spec/<name>/index.md`

    Plan mode never marks this PR ready for review. Once you have
    reviewed (and edited) the spec, mark it ready and merge to `main`.
    Implementation work begins in a separate run with `jarvis run
    spec/<name>/index.md` after the merge.
    ```

    `<name>` is interpolated literally. The "Plan mode never marks
    this PR ready" paragraph is load-bearing and must be preserved
    verbatim by every PR-body update path (initial create, live
    rewrite on subspec commits, resume).
  - **Narrative section.** When the PR is first created in this
    subspec the area between the markers is empty (placeholder commits
    only — no agent-authored summary exists yet). Later plan-mode
    specs (draft, review, resume) populate and update it.
  - **Attribution footer.** Rendered from the `Jarvis-Agent` trailers
    on the PR-branch's `plan: ...` commits, exactly like patch mode.
    For the initial open in this subspec the only commits on the
    branch are the placeholder `plan: interview` and `plan: draft`
    commits, neither of which has an agent label (no agent ran), so
    the footer is empty by construction. As real agent-driven `plan:
    draft` / `plan: review N` commits arrive in later specs, the
    footer fills in automatically through the existing live-update
    path.
- **PR creation failure** (e.g. `gh` not authenticated, repo missing
  PR permissions) exits `1` with the `gh` error verbatim. The
  underlying commits stay; the user can re-run `gh pr create` manually
  using the printed branch name. We do **not** add a `--no-pr` flag in
  this skeleton.
- **Idempotence.** If a PR already exists for `plan/<name>` (e.g. the
  user re-ran `jarvis plan` after a previous run pushed but failed to
  open the PR), `ensureDraftPr` already detects via `gh pr view` and
  reuses it. Plan mode inherits that behavior; do not open a duplicate.
- **PR URL printed to stdout** on success: a single line, just the
  URL, suitable for clicking from a terminal.
- **No transition to ready-for-review.** Plan mode never calls `gh pr
  ready`. Confirmed and re-asserted in
  `spec/plan-mode-resume-and-handoff/02-separation-from-run.md`.
- **No agent calls.**

## Implementation hints

- If `ensureDraftPr` currently bakes in patch-mode-specific header
  text, parameterize the header (and any title prefix) so plan mode
  can supply its own. Keep narrative-marker handling and attribution
  rendering shared — those are mode-agnostic.
- The "live rewrite the body on each subspec commit" path in patch
  mode (see `src/modes/patch/run.ts` around the `ensureDraftPr` calls
  per subspec commit) should be reused by plan mode's `plan: draft`
  and `plan: review N` commits when those land in later specs. This
  subspec only needs to make sure the helper is structured so plan
  mode can call it.

## Tasks

- [ ] Make `ensureDraftPr` (or a thin plan-mode-specific wrapper)
  accept a caller-supplied deterministic header and PR title prefix
  while keeping the narrative-marker and attribution-footer logic
  shared with patch mode.
- [ ] Wire it into `planCommand` after the `plan: draft` push succeeds.
- [ ] Print the PR URL to stdout.
- [ ] Tests:
  - Successful `gh pr create` invocation builds the documented title
    and body, with `<name>` interpolated, the narrative markers
    present (and empty between them), and an empty attribution
    footer (since the placeholder commits carry no `Jarvis-Agent`
    trailer).
  - Existing PR for `plan/<name>` is reused (URL printed; no second
    create call).
  - `gh pr create` failure exits `1` with the error visible.
  - Body always contains the "Plan mode never marks this PR ready"
    paragraph verbatim.

## Acceptance criteria

- [ ] After a successful `jarvis plan` run, a draft PR exists for
  `plan/<name>` with the documented title and the documented
  three-part body shape (deterministic header + empty narrative
  section + empty attribution footer for the placeholder commits).
- [ ] The PR is **draft**; plan mode never calls `gh pr ready`.
- [ ] PR URL is printed to stdout on success.
- [ ] Re-running `jarvis plan` against the same `<name>` reuses the
  existing PR rather than failing or duplicating.
- [ ] `bun run typecheck`, `bun test`, `bun run check` all pass.

## Documentation updates

- None. Subspec 07 covers docs.
