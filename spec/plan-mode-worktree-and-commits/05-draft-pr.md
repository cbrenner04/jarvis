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
- **Tool:** reuse the existing PR-body machinery, which today is split
  across two modules:
  - `src/pr.ts` owns `ensureDraftPr` (mode-agnostic: `gh pr create
    --draft` / `gh pr view` idempotence, takes a `bodyGenerator`
    callback and an attribution `footer` string) and
    `renderAttribution` (renders the `Jarvis-Agent`-trailer footer
    from `git log <base>..HEAD`). These are already mode-agnostic —
    plan mode calls them directly.
  - `src/modes/patch/pr.ts` owns the deterministic-header / narrative
    assembly (`buildPrBody`, `extractNarrative`, `updatePrBody`, and
    the `NARRATIVE_START_MARKER` / `NARRATIVE_END_MARKER` constants).
    These are coupled to patch mode today because `buildPrBody` reads
    a spec `index.md` and renders patch-mode's `## Progress` /
    `## Subspecs` checklist. Plan mode's deterministic header is
    different (see below) and does not need that progress table.

  This subspec lifts the **mode-agnostic pieces** out of
  `src/modes/patch/pr.ts` into a new shared module
  (`src/pr-body.ts`, or extend `src/pr.ts`): the narrative markers,
  `extractNarrative`, and a generic `updatePrBody` that takes a
  caller-supplied header builder. Patch mode's existing `buildPrBody`
  becomes a header builder it passes in; plan mode adds a
  `buildPlanPrHeader({ name })` that produces the header text below.
  Patch-mode behavior must be unchanged after the lift.
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

- `ensureDraftPr` in `src/pr.ts` is already mode-agnostic — it takes
  `branch`, `base`, `title`, a `bodyGenerator`, and a `footer`. Plan
  mode passes its own title/header generator in and can call it
  directly; no change to that signature is needed beyond what falls
  out of relocating header construction.
- The "live rewrite the body on each subspec commit" path in patch
  mode lives in `src/modes/patch/pr.ts:updatePrBody` and is invoked
  from `src/modes/patch/run.ts` around line 881 (the `ensureDraftPr`
  call site). After the lift in the decisions above, plan mode's
  `plan: draft` (and later `plan: review N`) commits call the same
  shared `updatePrBody` with a plan-mode header builder. This subspec
  only needs to make sure the lift lands and plan mode's first call
  works for the placeholder commits.

## Tasks

- [ ] Lift the narrative markers, `extractNarrative`, and a generic
  `updatePrBody` (taking a caller-supplied header builder) out of
  `src/modes/patch/pr.ts` into a shared module. Re-import from the
  patch-mode module so its callers are unchanged.
- [ ] Add `buildPlanPrHeader({ name })` returning the deterministic
  header text below.
- [ ] Wire `ensureDraftPr` (with the plan-mode title and header) and
  the shared `updatePrBody` into `planCommand` after the `plan: draft`
  push succeeds.
- [ ] Print the PR URL to stdout. Reuse the URL printer from
  `print-pr-link-on-completion` if one already exists; otherwise read
  the URL via `gh pr view <branch> --json url -q .url` after the
  create/reuse and write a single line to stdout.
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

- [x] After a successful `jarvis plan` run, a draft PR exists for
  `plan/<name>` with the documented title and the documented
  three-part body shape (deterministic header + empty narrative
  section + empty attribution footer for the placeholder commits).
- [x] The PR is **draft**; plan mode never calls `gh pr ready`.
- [x] PR URL is printed to stdout on success.
- [x] Re-running `jarvis plan` against the same `<name>` reuses the
  existing PR rather than failing or duplicating.
- [x] `bun run typecheck`, `bun test`, `bun run check` all pass.

## Documentation updates

- None. Subspec 07 covers docs.
