# 05 — Draft PR open with fixed-template body

## Problem

After the `plan: draft` commit lands on the remote, plan mode opens a
draft PR so reviewers can see the work in progress. The PR title and
body shape are fixed for now — no agent-generated summary — to keep
this skeleton spec free of agent calls.

The draft PR is **never** flipped to ready-for-review by jarvis. The
human merges the spec PR into `main` after review. This separation
becomes load-bearing for the merge-first rule that
`spec/plan-mode-resume-and-handoff/` enforces.

## Decisions

- **When:** open the PR immediately after the `plan: draft` commit's
  push succeeds.
- **Tool:** `gh pr create --draft --base <default-branch> --head
  plan/<name> --title "<title>" --body "<body>"`. Reuse the same `gh`
  invocation helpers patch mode uses.
- **Title:** `plan: <name>`. No truncation; `<name>` is already short.
- **Body (fixed template):**

  ```md
  This PR was authored by `jarvis plan`. It contains a generated
  spec tree under `spec/<name>/` for human review.

  - Intent: `spec/<name>/intent.md`
  - Index: `spec/<name>/index.md`

  Plan mode never marks this PR ready for review. Once you have
  reviewed (and edited) the spec, mark it ready and merge to `main`.
  Implementation work begins in a separate run with `jarvis run
  spec/<name>/index.md` after the merge.

  ---
  Written by <attribution> through Jarvis.
  ```

  `<name>` is interpolated literally. `<attribution>` is the same
  attribution string patch mode appends today (per `AGENTS.md` PR
  attribution rules). Since this skeleton spec doesn't actually invoke
  an agent, attribution falls back to the configured default for the
  first agent in `planAgentOrder` (or `agentOrder` when
  `planAgentOrder` is unset/empty), labeled with the
  `<cli-name> (default model)` form.
- **PR creation failure** (e.g. `gh` not authenticated, repo missing
  PR permissions) exits `1` with the `gh` error verbatim. The
  underlying commits stay; the user can re-run `gh pr create` manually
  using the printed branch name. We do **not** add a `--no-pr` flag in
  this skeleton.
- **Idempotence.** If a PR already exists for `plan/<name>` (e.g. the
  user re-ran `jarvis plan` after a previous run pushed but failed to
  open the PR), detect via `gh pr view plan/<name> --json url` and
  reuse the existing PR — print its URL and continue. Do not open a
  duplicate.
- **PR URL printed to stdout** on success: a single line, just the
  URL, suitable for clicking from a terminal.
- **No transition to ready-for-review.** Plan mode never calls `gh pr
  ready`. Confirmed and re-asserted in
  `spec/plan-mode-resume-and-handoff/02-separation-from-run.md`.
- **No agent calls.**

## Implementation hints

- The patch-mode PR-open helper (likely `ensureDraftPr` per
  `AGENTS.md`) is the closest precedent. Either call it with
  plan-mode-specific title/body inputs or fork a slimmer
  `ensurePlanDraftPr` if the patch helper has too much patch-mode
  baggage.
- Attribution string assembly may currently live inside `ensureDraftPr`;
  if so, extract a small `composeAttributionFooter()` helper so plan
  mode can compose the same footer without going through patch-mode
  flow.

## Tasks

- [ ] Implement `ensurePlanDraftPr({ projectRoot, name, attribution })`
  (or extend the existing helper).
- [ ] Wire it into `planCommand` after the `plan: draft` push succeeds.
- [ ] Print the PR URL to stdout.
- [ ] Tests:
  - Successful `gh pr create` invocation builds the documented title
    and body, with `<name>` and `<attribution>` interpolated.
  - Existing PR for `plan/<name>` is reused (URL printed; no second
    create call).
  - `gh pr create` failure exits `1` with the error visible.
  - Body always contains the "Plan mode never marks this PR ready"
    paragraph.

## Acceptance criteria

- [ ] After a successful `jarvis plan` run, a draft PR exists for
  `plan/<name>` with the documented title and body shape.
- [ ] The PR is **draft**; plan mode never calls `gh pr ready`.
- [ ] PR URL is printed to stdout on success.
- [ ] Re-running `jarvis plan` against the same `<name>` reuses the
  existing PR rather than failing or duplicating.
- [ ] `bun run typecheck`, `bun test`, `bun run check` all pass.

## Documentation updates

- None. Subspec 07 covers docs.
