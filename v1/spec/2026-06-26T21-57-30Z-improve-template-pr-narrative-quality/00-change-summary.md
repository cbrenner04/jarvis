# 00 - Change summary from the branch diff

## Problem

`generateTemplateNarrative` emits `## Subspecs` (titles) and `## Commits`
(subjects) only — a reviewer sees the work-item labels but nothing about what the
diff actually touched. Add a deterministic, token-free `## Change summary` derived
from the branch diff (`base..HEAD`) so the narrative carries real review signal.

## Decisions

- Diff fed in via an injected stat seam (like the existing subspec/commit seams), not read inside `generateTemplateNarrative` — keeps the render function pure and unit-testable. Rules out shelling to git from within the pure renderer.
- Group touched files by area = first two path segments (root-level files under a single `(root)` bucket); rules out coarse first-segment grouping that collapses `v1/src`, `v1/docs`, `v1/test` into one `v1`, and rules out per-file noise.
- Area rows ordered by changed-line count desc, then path asc — deterministic, no ties left to insertion order.
- Empty diff omits the `## Change summary` section entirely; rules out emitting a "0 files changed" stub, matching existing empty-section handling for Subspecs/Commits.
- Binary numstat entries (`-`/`-`) count toward files-changed but contribute 0 to line totals; rules out crashing on non-numeric numstat or fabricating line counts.

## Task checklist

- [ ] Add a diff-stat seam to `generateTemplateNarrative` and render a `## Change summary` section (total files + aggregate +/- lines, per-area breakdown).
- [ ] Wire the production seam (`git diff --numstat base..HEAD`) in `pr-module.ts` alongside the existing commit/subspec seams.
- [ ] Update `v1/docs/worktrees-and-commits.md` template-mode description and `v2/docs/v1-behaviors.md` to match the new output.

## Acceptance criteria

- [ ] The `template` PR narrative includes a `## Change summary` section reporting total files changed and aggregate added/removed line counts from the branch diff (`base..HEAD`), produced with no agent invocation.
- [ ] Change summary breaks the diff down by touched area (path grouping), ordered deterministically, so the reviewer sees where the change lands.
- [ ] When the branch diff is empty, the `## Change summary` section is omitted (no empty stub).
- [ ] Binary-file diff entries (numstat `-`/`-`) count toward files-changed but contribute zero to the line totals.
- [ ] Existing `## Subspecs` / `## Commits` template content is preserved: `run.test.ts` template-narrative PR-body assertions stay green.
- [ ] The narrative stays marked generated (`<!-- jarvis:narrative:generated-sha256:` present) and regenerates on each rewrite.

## Documentation updates

- `v1/docs/worktrees-and-commits.md`: template-mode narrative bullet now describes the change-summary section.
- `v2/docs/v1-behaviors.md`: shared-PR-narrative entry updated to reflect diff-derived template output.
