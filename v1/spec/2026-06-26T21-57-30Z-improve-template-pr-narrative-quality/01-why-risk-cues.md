# 01 - Why and risk cues

## Problem

After 00 the template narrative shows *what* changed (diff summary) but still not
*why* or *what's risky*. Add deterministic, token-free cues: a risk flag drawn
from the diff and a per-subspec why line drawn from spec text.

## Decisions

- Risk cues are categorical, not threshold/scale labels: emit a "no test changes" cue when the diff touches non-test source files but no test files. Rules out an arbitrary magic-number "large change" classifier (invented precision); the 00 +/- counts already convey scale.
- Test-file detection by path (`*.test.ts` or a `test/` path segment); rules out content inspection.
- Why cue = first prose line of each subspec body (skip the H1, headings, list items, blanks), via a subspec-body seam. Rules out an agent call and rules out dumping whole Problem sections into the PR.
- Subspecs with no extractable prose line contribute no why line (silently skipped); rules out emitting empty bullets.

## Task checklist

- [ ] Derive the test-coverage risk cue from the 00 diff stat and render it in the narrative.
- [ ] Add a subspec-body seam and render a per-subspec why line sourced from spec text.
- [ ] Update `v1/docs/worktrees-and-commits.md` and `v2/docs/v1-behaviors.md` to match.

## Acceptance criteria

- [ ] The `template` narrative emits a deterministic "no test changes" risk cue when the branch diff changes non-test source files but no test files.
- [ ] The `template` narrative surfaces a why cue per subspec, sourced from the subspec's spec text (its first prose line), with no agent invocation.
- [ ] A subspec with no extractable prose line produces no why entry (no empty bullet).
- [ ] Risk and why cues are produced token-free (no model call) and are byte-stable across repeated rewrites of an unchanged branch.
- [ ] The change-summary, `## Subspecs`, and `## Commits` content from 00 stays green: `run.test.ts` template-narrative PR-body assertions still pass.

## Documentation updates

- `v1/docs/worktrees-and-commits.md`: template-mode bullet now lists the why/risk cues.
- `v2/docs/v1-behaviors.md`: shared-PR-narrative entry updated to include the deterministic why/risk cues.
