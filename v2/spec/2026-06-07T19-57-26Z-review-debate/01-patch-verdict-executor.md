# 01 - Patch: read-only reviewers + patch-loop verdict executor

Wire patch mode onto the debate engine (subspec 00). Patch reviewers (adversary/defender/judge) review the branch diff vs base and emit artifacts; the **patch loop is the verdict executor** and the only writer. Files: `v1/src/modes/patch/review.ts`, `v1/src/modes/patch/run.ts`, `v1/src/modes/patch/prompt.ts`, and patch role prompts under `prompts/patch/`.

This inverts today's patch review, where the review agent refactors code in place. Now reviewers are read-only against the code; the executor (patch loop) applies the verdict.

## Decisions

- Patch reviewers are read-only on code; the patch-loop executor is the only writer. — rules out today's in-place refactor, which conflates reviewing- and executing-class work and lets review grade its own fix (self-vindication).
- The verdict is injected as the executor's task, replacing first-unchecked-task selection (`getFirstUncheckedTask` / `buildPrompt`) for that one invocation. — rules out translating the verdict into a synthetic checklist item.
- The verdict is outcome-altitude (what must be true and why, not the diff), enforced by the judge prompt, not a gate. — rules out a mechanical over-specification check.
- The executor agent is a fresh agent with no debate memory; the verdict must restate the upheld findings and required outcomes (self-contained), never "see the adversary artifact." — rules out passing role artifacts into the executor prompt.
- Per-role commits: `review: adversary`, `review: defense`, `review: judge`, `review: executor`; existing no-change skip means an empty verdict produces no executor commit. — rules out a separate verdict sentinel.
- Reviewer roles reuse the existing review agent order/fallback; the executor uses the patch (executing-class) agent order, preserving the model-class split. — rules out one model doing both reviewing and executing.
- Pin here (first consumer): debate artifacts are committed as the per-role trail but scoped so they do not appear in the merged PR's reviewable diff. — rules out trail files silently shipping in the PR (patch branch is the PR branch). Choose and document the scoping mechanism during implementation.

## Task Checklist

- [ ] Add patch role prompts (adversary findings, defender rebuttal, judge verdict) under `prompts/patch/`, registered in `prompts/registry.txt`; verdict prompt enforces outcome-altitude and self-containment.
- [ ] Make the patch review adapter role-aware: select the role prompt, write each role's artifact, and inject the prior role's artifact into the next reviewer's prompt.
- [ ] Make patch reviewers read-only on code (revert/forbid code edits during reviewer roles, mirroring today's spec-tree revert).
- [ ] Wire the patch loop as the injected executor: when invoked with a verdict, run one iteration whose task is the verdict instead of the first unchecked checklist item.
- [ ] Persist debate artifacts as the per-role trail, scoped out of the merged PR diff; commit each role with its subject.

## Documentation updates

- [ ] Update `v2/docs/v1-behaviors.md`: patch review is now read-only reviewers (adversary/defender/judge) + a patch-loop executor; the executor's input is the verdict, not first-unchecked-task selection; per-role commits and artifact scoping; reviewers no longer refactor code in place.

## Acceptance criteria

- [ ] Patch review runs the three reviewer roles read-only against the branch diff; reviewer-role code edits are reverted/blocked, and only the executor writes code.
- [ ] The patch-loop executor runs the verdict as its task for that invocation instead of selecting the first unchecked checklist item.
- [ ] Registered patch role prompts exist for adversary, defender, and judge; the judge prompt instructs outcome-altitude (what/why, not the diff) and a self-contained verdict that restates upheld findings.
- [ ] Each reviewer role's artifact is injected into the next role's prompt via the adapter; the executor prompt does not depend on reading prior role artifacts.
- [ ] Per-role commits are emitted (`review: adversary` / `defense` / `judge` / `executor`); an empty verdict yields no executor run and no executor commit.
- [ ] Debate artifacts are committed as the trail but do not appear in the merged PR's reviewable diff; the scoping mechanism is documented.
- [ ] Reviewer roles use the review agent order; the executor uses the patch agent order (model-class split preserved).
- [ ] Tests cover the verdict-as-task input contract and read-only reviewer enforcement for patch.
- [ ] `v2/docs/v1-behaviors.md` reflects the new patch review behavior.
