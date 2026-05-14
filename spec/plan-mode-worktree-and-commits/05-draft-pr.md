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
  ```

  `<name>` is interpolated literally. **No attribution footer is
  emitted by this spec.** Attribution on plan-mode PRs is
  intentionally deferred: it depends on a separate, not-yet-merged
  spec that will (a) add a "rewrite the PR description on each commit
  / on completion" mechanism so the description can reflect every
  agent that contributed, and (b) decide how to label
  harness-authored placeholder content distinctly from
  agent-authored content. Until that spec lands, the body above is
  the literal final body. Any later spec that revisits this body
  (including the future attribution spec) is responsible for
  preserving the "Plan mode never marks this PR ready" paragraph
  verbatim.

  **Why no fallback footer.** Adding a `Written by Jarvis (default
  model) through Jarvis.` footer here would attribute placeholder
  content to a real agent that did no work, and the future
  PR-description-update spec would have to either parse and rewrite
  it or duplicate it. Either path is more friction than just leaving
  it out of this skeleton.
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
- Do not invoke the patch-mode attribution-footer assembly path from
  plan mode. If it is currently inlined in `ensureDraftPr`, the
  cleanest implementation is the slim fork; if you reuse the patch
  helper, pass an explicit "no footer" signal so plan-mode bodies
  stay verbatim.

## Tasks

- [ ] Implement `ensurePlanDraftPr({ projectRoot, name })` (or
  extend the existing helper) that does **not** append an
  attribution footer.
- [ ] Wire it into `planCommand` after the `plan: draft` push succeeds.
- [ ] Print the PR URL to stdout.
- [ ] Tests:
  - Successful `gh pr create` invocation builds the documented title
    and body, with `<name>` interpolated and **no** attribution
    footer present.
  - Existing PR for `plan/<name>` is reused (URL printed; no second
    create call).
  - `gh pr create` failure exits `1` with the error visible.
  - Body always contains the "Plan mode never marks this PR ready"
    paragraph.

## Acceptance criteria

- [ ] After a successful `jarvis plan` run, a draft PR exists for
  `plan/<name>` with the documented title and body shape, with no
  attribution footer.
- [ ] The PR is **draft**; plan mode never calls `gh pr ready`.
- [ ] PR URL is printed to stdout on success.
- [ ] Re-running `jarvis plan` against the same `<name>` reuses the
  existing PR rather than failing or duplicating.
- [ ] `bun run typecheck`, `bun test`, `bun run check` all pass.

## Documentation updates

- None. Subspec 07 covers docs.
