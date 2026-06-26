# 00 - Change summary from the branch diff

## Problem

`generateTemplateNarrative` emits `## Subspecs` (titles) and `## Commits`
(subjects) only — a reviewer sees the work-item labels but nothing about what the
diff actually touched. Add a deterministic, token-free `## Change summary` derived
from the branch diff so the patch-mode narrative carries real review signal.

`generateTemplateNarrative` has two production call sites and the new section must
appear identically at both:

- **Rewrite** — shared `updatePrBody` in `v1/src/pr-module.ts`, reached by the
  patch-mode wrapper `v1/src/modes/patch/pr.ts` and the plan-mode wrapper
  `v1/src/modes/plan/pr.ts`.
- **Draft creation** — `generatePrBody` in
  `v1/src/modes/patch/completion-pipeline.ts` (patch mode only).

## Decisions

- Diff fed in via an injected stat seam (like the existing subspec/commit seams), not read inside `generateTemplateNarrative` — keeps the render function pure and unit-testable. Rules out shelling to git from within the pure renderer.
- The diff-stat seam is optional; the `## Change summary` section renders only when a caller supplies it. Patch-mode callers (draft-creation + the patch rewrite wrapper) supply it; the plan-mode rewrite wrapper does not, so plan PR narratives are unchanged. Rules out reporting diff stats over spec markdown on plan PRs (a permanent false signal) — the intent is implementation-review value.
- Diff read with three-dot range `git diff --numstat base...HEAD` (merge-base to HEAD) to match the commit set shown by `git log base..HEAD`; rules out the two-dot endpoint diff, which diverges from that commit set once base advances past the merge-base.
- Group touched files by area = the file's containing directory, truncated to at most its first two path segments; root-level files (no directory) bucket under `(root)`. So `v1/src/modes/patch/x.ts` → `v1/src`, `scripts/foo.sh` → `scripts`, `prices.json` → `(root)`. Rules out per-file areas for shallow paths and rules out coarse first-segment grouping that collapses `v1/src`, `v1/docs`, `v1/test` into one `v1`.
- Area rows ordered by changed-line count desc, then path asc — deterministic, no ties left to insertion order.
- Empty diff omits the `## Change summary` section entirely; rules out emitting a "0 files changed" stub, matching existing empty-section handling for Subspecs/Commits.
- Binary numstat entries (`-`/`-`) count toward files-changed but contribute 0 to line totals; rules out crashing on non-numeric numstat or fabricating line counts.

## Task checklist

- [ ] Add an optional diff-stat seam to `generateTemplateNarrative` and render a `## Change summary` section (total files + aggregate +/- lines, per-area breakdown) when supplied.
- [ ] Wire the production seam (`git diff --numstat base...HEAD`) at both patch-mode call sites: draft creation (`completion-pipeline.ts`) and the patch rewrite wrapper (`modes/patch/pr.ts`, threaded through `pr-module.ts` opts). Leave the plan-mode wrapper unwired.
- [ ] Update `v1/docs/worktrees-and-commits.md` template-mode description and `v2/docs/v1-behaviors.md` to match the new output.

## Acceptance criteria

- [ ] The patch-mode `template` PR narrative includes a `## Change summary` section reporting total files changed and aggregate added/removed line counts from the branch diff (`base...HEAD`), produced with no agent invocation.
- [ ] Change summary breaks the diff down by touched area (containing directory capped at two path segments; root-level files under `(root)`), ordered by changed lines desc then path asc, so the reviewer sees where the change lands.
- [ ] A newly created patch-mode draft PR carries the same `## Change summary` content as a later rewrite of the same branch (draft-creation and rewrite call sites are both wired).
- [ ] Plan-mode `template` PR narratives are unchanged: no `## Change summary` section appears on plan PRs.
- [ ] When the branch diff is empty, the `## Change summary` section is omitted (no empty stub).
- [ ] Binary-file diff entries (numstat `-`/`-`) count toward files-changed but contribute zero to the line totals.
- [ ] Existing `## Subspecs` / `## Commits` template content is preserved: `run.test.ts` template-narrative PR-body assertions stay green.
- [ ] The narrative stays marked generated (`<!-- jarvis:narrative:generated-sha256:` present) and regenerates on each rewrite.

## Documentation updates

- `v1/docs/worktrees-and-commits.md`: template-mode narrative bullet now describes the change-summary section and notes it is patch-mode only.
- `v2/docs/v1-behaviors.md`: shared-PR-narrative entry updated to reflect diff-derived template output and its patch-mode scope.
