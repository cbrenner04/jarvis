# 02 - Plan: read-only reviewers + refine-loop verdict executor

Wire plan mode onto the debate engine (subspec 00). Plan reviewers (adversary/defender/judge) review the spec draft and emit artifacts; the **refine loop is the verdict executor** and the only writer of the spec. Files: `v1/src/modes/plan/review.ts`, the refine loop (`v1/src/modes/plan/refine.ts`), and plan role prompts under `prompts/plan/`.

Plan review writes the spec inline today, so this introduces the verdict → refine seam that does not yet exist.

## Decisions

- Plan reviewers are read-only on the spec; the refine loop is the executor and the only writer. — rules out today's inline spec rewrite during review (self-vindication; review grading its own edit).
- The verdict drives one refine invocation as its task, replacing the refine loop's normal input, under the refine loop's existing spec-dir write boundary. — rules out the judge writing spec edits directly.
- Per-role commits reuse plan commit numbering/resume-suffix conventions: `review: adversary` / `defense` / `judge` / `executor`; empty verdict → existing no-change skip, no executor commit.
- Reviewer roles reuse the review agent order; the executor (refine) uses the plan/executing agent order, preserving the model-class split.
- The executor is a fresh agent; the verdict restates upheld findings and required spec outcomes (self-contained). — rules out feeding role artifacts into the refine prompt.

## Task Checklist

- [ ] Add plan role prompts (adversary findings, defender rebuttal, judge verdict over the spec draft) under `prompts/plan/`, registered in `prompts/registry.txt`.
- [ ] Make the plan review adapter role-aware: select the role prompt, write each role's artifact, inject the prior role's artifact into the next reviewer's prompt.
- [ ] Make plan reviewers read-only on the spec (no inline spec rewrite during reviewer roles).
- [ ] Wire the refine loop as the injected executor: run it with the verdict as its task, under the existing plan write boundary, committing `review: executor`.

## Documentation updates

- [ ] Update `v2/docs/v1-behaviors.md`: plan review is now read-only reviewers (adversary/defender/judge) + a refine-loop executor that applies the verdict under the spec-dir write boundary; reviewers no longer rewrite the spec inline; per-role commits and the verdict → refine seam.

## Acceptance criteria

- [ ] Plan review runs the three reviewer roles read-only against the spec draft; reviewer roles do not write spec files, and only the refine executor writes the spec.
- [ ] The refine loop runs the verdict as its task, under the existing plan write boundary (spec-dir-only, `intent.md` immutable except `## Blocker`).
- [ ] Registered plan role prompts exist for adversary, defender, and judge; the judge prompt instructs a self-contained, outcome-altitude verdict.
- [ ] Each reviewer role's artifact is injected into the next role's prompt; the executor prompt does not depend on reading prior role artifacts.
- [ ] Per-role commits are emitted with plan numbering/resume-suffix conventions; an empty verdict yields no executor run and no executor commit.
- [ ] Reviewer roles use the review agent order; the refine executor uses the plan agent order (model-class split preserved).
- [ ] Tests cover the verdict → refine seam and read-only reviewer enforcement for plan.
- [ ] `v2/docs/v1-behaviors.md` reflects the new plan review behavior.
