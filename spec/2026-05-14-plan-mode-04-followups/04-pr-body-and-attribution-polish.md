# 04 — PR body and attribution polish

## Problem

PR #30 wired plan-mode commits into the existing PR-body rewrite path
and made `buildPlanPrHeader` mirror the `index.md` checklist. Several
secondary review notes (**#31**, **#32–#36**, **#37**, **#40**, **#41**,
**#44**, **#45**, **#47**) flagged smaller polish items on top of that:

- The header repeats the spec name in three places (title fallback,
  Intent line, Index line).
- The fallback title `# plan: <name>` differs in case/format from the
  H1 the agent eventually writes; switching from "fallback" to "real"
  on the next rewrite causes a visible churn in the PR body history.
- The `## Progress: 0/0` line during the very first rewrite (after
  `plan: draft` lands but before any subspec is checked) is technically
  correct but reads oddly when there are subspecs but none checked yet
  — it should still say `0/<N>`, which the current code already does;
  but the empty-checklist case (`0/0`) should be hidden.
- The attribution footer's per-commit list can grow long for plan mode
  (interview + draft + N reviews + blocker can be 5+ commits before any
  subspec exists). For plan-mode PRs there is no value in listing every
  commit individually before the first real subspec lands.
- `## Progress` heading collides visually with the index's own
  `## Progress` if a future spec author ever adds one. Rename the
  plan-mode line to something less ambiguous.

## Decisions

- **Hide `## Progress` when total is zero.** When `parseIndex` returns
  zero subspecs, omit the progress line entirely from the rendered
  header. The "Intent" and "Index" pointers and the prose paragraph
  still render.
- **Stable fallback title.** Change the fallback title from
  `# plan: <name>` to `# Plan: <name>`. This matches GitHub's display
  conventions and reduces the diff once the agent writes a real H1
  (which typically starts with a capital letter anyway).
- **Plan-mode attribution collapses non-subspec commits.** Extend the
  attribution renderer in `src/pr.ts` (or add a plan-mode-specific
  variant in `src/modes/plan/pr.ts`) so that consecutive plan-mode
  meta-commits (`plan: interview`, `plan: draft`, `plan: review N`,
  `plan: blocker`) on a plan-mode branch render as a single summary
  line instead of one bullet per commit. The summary line names the
  agents involved (deduped) and counts the commits. Subspec commits
  on the same branch (none today, but this guards against future
  cross-mode branches) still render as individual bullets.
- **No PR-title rewrites.** PR title remains `plan: <name>` from
  initial creation. Only the body is rewritten on each plan commit.

## Acceptance criteria

- [ ] `buildPlanPrHeader` omits the `## Progress` line when the index
  has zero subspecs; a unit test covers this case alongside the
  existing "with subspecs" test.
- [ ] Fallback title is `# Plan: <name>`; the existing
  `pr.test.ts` test that asserts the fallback shape is updated.
- [ ] A new attribution renderer (or an extension to `renderAttribution`)
  collapses plan-mode meta-commits into a single summary line on
  plan-mode PRs. Unit tests cover: only meta-commits, mixed
  meta-and-subspec commits, single meta-commit.
- [ ] `bun run typecheck`, `bun test`, and `bun run check` all pass.

## Documentation updates

- Update `docs/plan-mode.md` "PR lifecycle" subsection to describe
  the collapsed attribution.
- Update `AGENTS.md` "PR attribution" section to note the plan-mode
  collapsing rule (one paragraph; cross-references the plan-mode
  doc for details).
- No changes to `README.md` or `docs/spec-guidance.md`.
