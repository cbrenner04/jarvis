# 01 - Why and risk cues

## Problem

After 00 the template narrative shows *what* changed (diff summary) but still not
*why* or *what's risky*. Add deterministic, token-free cues: a risk flag drawn
from the diff and a per-subspec why line drawn from spec text. Like 00, these are
patch-mode signals and must be wired at both patch call sites (draft creation in
`completion-pipeline.ts` and the patch rewrite wrapper `modes/patch/pr.ts`);
the plan-mode wrapper supplies neither, so plan PR narratives stay unchanged.

## Decisions

- Risk and why cues render only when their seams are supplied; only patch-mode callers supply them. Rules out a "no test changes" cue firing on every plan PR (whose diff is spec markdown) — a permanent false positive.
- Risk cues are categorical, not threshold/scale labels: emit a "no test changes" cue when the diff touches non-test **source** files but no test files. Rules out an arbitrary magic-number "large change" classifier (invented precision); the 00 +/- counts already convey scale.
- "Source file" = a code file: exclude test files (below), docs (`*.md`, `v1/docs/**`, `v2/docs/**`), and config/data (`*.json`). So a docs-only or config-only diff — including this spec's own doc updates — touches no source files and produces no risk cue. Rules out the cue firing on documentation or config changes.
- Test-file detection by path (`*.test.ts` or a `test/` path segment); rules out content inspection.
- Why cue = first prose line of each subspec body (skip the H1, headings, list items, blanks), via a subspec-body seam. Rules out an agent call and rules out dumping whole Problem sections into the PR.
- Each patch caller supplies subspec bodies the same way it already supplies titles: parse the index for linked subspec paths, then read each subspec file. Rules out a new path-discovery mechanism. (Plan mode does not wire the seam, so it needs no body source.)
- Why line truncated to a fixed character bound with a trailing `…` when longer; rules out a single long paragraph landing whole in the PR body.
- Subspecs with no extractable prose line contribute no why line (silently skipped); rules out emitting empty bullets.

## Task checklist

- [ ] Derive the test-coverage risk cue from the 00 diff stat (source vs test classification) and render it in the narrative when the diff-stat seam is supplied.
- [ ] Add an optional subspec-body seam and render a per-subspec why line (truncated) sourced from spec text; wire it at both patch call sites by reading each linked subspec file.
- [ ] Update `v1/docs/worktrees-and-commits.md` and `v2/docs/v1-behaviors.md` to match.

## Acceptance criteria

- [x] The patch-mode `template` narrative emits a deterministic "no test changes" risk cue when the branch diff changes non-test source (code) files but no test files.
- [x] A docs-only or config-only branch diff produces no risk cue (docs `*.md` and config/data `*.json` are not source files).
- [x] The patch-mode `template` narrative surfaces a why cue per subspec, sourced from the subspec's first prose line, truncated with a trailing `…` when over the bound, with no agent invocation.
- [x] A subspec with no extractable prose line produces no why entry (no empty bullet).
- [x] A newly created patch-mode draft PR carries the same why/risk cues as a later rewrite of the same branch (both call sites wired).
- [x] Plan-mode `template` PR narratives are unchanged: no risk cue and no why cues appear on plan PRs.
- [x] Risk and why cues are produced token-free (no model call) and are byte-stable across repeated rewrites of an unchanged branch.
- [x] The change-summary, `## Subspecs`, and `## Commits` content from 00 stays green: `run.test.ts` template-narrative PR-body assertions still pass.

## Documentation updates

- `v1/docs/worktrees-and-commits.md`: template-mode bullet now lists the why/risk cues and their patch-mode scope.
- `v2/docs/v1-behaviors.md`: shared-PR-narrative entry updated to include the deterministic why/risk cues and their patch-mode scope.
