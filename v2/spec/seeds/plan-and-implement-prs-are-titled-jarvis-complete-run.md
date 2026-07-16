# Plan and implement PRs are titled `jarvis: complete run`; port v1's PR title + body

The PR-title fix landed on **one** publication path. `intent` names its PRs; `plan` and `implement`
do not, so both publish as the literal fallback and `main`'s history is a wall of
`jarvis: complete run (#NNNN)` — the commit log no longer says what any change did. **Critical:** the
squash-merge takes the PR title, so every merged v2 PR permanently loses its subject.

v1 already solved this. Reuse its convention rather than inventing one.

## Problem

Mechanism, current on `main` (post-collapse):

- `v2/src/execution/completion-publisher.ts:234` —
  `return typeof subject === "string" && subject.trim() ? subject.trim() : "jarvis: complete run";`
- `v2/src/execution/publication-workflow-steps.ts:304` sets `creationTitle: \`intent: ${seed.name}\``
  on the **intent** publication row only. The **plan** row (`:152`) sets no title, and the
  **implement** builder (`implement-workflow-steps.ts`) sets none — so the fallback fires for both.
- The PR **body** is `bodySummary` (`completion-publisher.ts:11`), populated only for intent runs
  (`intent-run-body-summary.ts`); plan and implement publish a generic body too.

Observed across this session: every plan and implement PR (#1567, #1568, #1572, #1579, #1580, #1585,
#1587, #1588, #1589, #1590, #1591, #1592) titled `jarvis: complete run`.

## The v1 convention to port

`shared/**` and `v2/**` cannot import `v1/**`, so **port the logic**, don't import it.

- **Title** — v1 `getIndexTitle` (`v1/src/modes/patch/completion-pipeline.ts:42`): the spec index's
  first `# ` heading, falling back to the spec-dir basename when there is no H1, or the file basename
  for a non-index spec. No generic string is ever emitted.
- **Body** — v1 `generatePrBody` (same file): a deterministic **template narrative** assembled from
  the linked subspec titles, the branch's commit subjects, the diff stats, and the subspec bodies,
  wrapped by `buildPrBody`. (v1 also supports an agent-authored narrative behind a
  `prNarrative: "agent"` config; the template is the default and is the target here — an agent
  narrative may follow but is not required.)

## Decisions

- **Every publication path resolves a real title from the spec, via one shared seam.** intent, plan,
  and implement all route through the ported `getIndexTitle` equivalent. Rules out per-path
  `creationTitle` opt-in where forgetting to pass it silently yields a generic title.
- **The generic fallback is a defect, not a default.** A publication that cannot resolve a title
  fails named, rather than shipping `jarvis: complete run`. The branch name already carries the spec
  name, so a fallback exists — but it is a derived name, never the literal string.
- **Port the body template too.** Plan and implement PRs get the v1 template narrative (subspec
  titles + commit subjects + diff stats), not a bare body. This is the half the operator asked for
  explicitly alongside the title.
- **Keep `intent: <name>`** as intent's title (it already matches v1's spirit); the shared seam
  produces the H1 title for plan/implement. Rules out regressing the one path that works.

## Prerequisites

- None. The collapse's publication table (`publication-workflow-steps.ts`) is the natural home for
  the shared title/body seam and has already landed.

## Out of scope

- Retroactively fixing already-merged commit subjects on `main` (would require history rewrite).
  Editing the merged PRs' GitHub titles/bodies is a separate, optional operator cleanup.
- PRs publishing as **draft** — same seed family (`v2-workflow-pr-stays-draft-and-untitled`), separate
  mechanism (`gh pr ready` after the gate).

## Documentation updates

- `v2/docs/write-behavior.md` — the publication contract: what titles and describes a PR.
- `v2/docs/v1-behaviors.md` — record that v2 ports v1's `getIndexTitle` / template-narrative PR body.
