# 02 - Plan: read-only reviewers + refine-loop verdict executor

Wire plan mode onto the debate engine (subspec 00). Plan reviewers (adversary/defender/judge) review the spec draft and emit artifacts; the **refine loop is the verdict executor** and the only writer of the spec. Files: `v1/src/modes/plan/review.ts`, the refine loop (`v1/src/modes/plan/refine.ts`), and plan role prompts under `prompts/plan/`.

Plan review writes the spec inline today, so this introduces the verdict → refine seam that does not yet exist.

## Decisions

- Plan reviewers are read-only on the spec; the refine loop is the executor and the only writer. — rules out today's inline spec rewrite during review (self-vindication; review grading its own edit).
- The verdict drives one refine invocation as its task, replacing the refine loop's normal input, under the refine loop's existing spec-dir write boundary. — rules out the judge writing spec edits directly.
- Per-role commits reuse plan commit numbering/resume-suffix conventions: `review: adversary` / `defense` / `judge` / `executor`; empty verdict → existing no-change skip, no executor commit.
- Reviewer roles reuse the review agent order; the executor (refine) uses the plan/executing agent order, preserving the model-class split.
- The executor is a fresh agent; the verdict restates upheld findings and required spec outcomes (self-contained). — rules out feeding role artifacts into the refine prompt.
- The verdict is a durable doc in the spec folder, plan-distinct filename (e.g. `verdict-plan.md`), overwritten each cycle. — distinct from patch's filename so one folder carries both over its lifetime. "Read-only on the spec" covers the reviewed spec files (index/subspecs/intent) only; the adapter still writes the verdict, which is not a subspec pointer and so does not affect index completeness.

## Task Checklist

- [x] Add plan role prompts (adversary findings, defender rebuttal, judge verdict over the spec draft) under `prompts/plan/`, registered in `prompts/registry.txt`.
- [x] Make the plan review adapter role-aware: select the role prompt, write each role's artifact, inject the prior role's artifact into the next reviewer's prompt.
- [x] Make plan reviewers read-only on the spec (no inline spec rewrite during reviewer roles).
- [x] Wire the refine loop as the injected executor: run it with the verdict as its task, under the existing plan write boundary, committing `review: executor`.
- [x] Persist the verdict as a durable doc in the spec folder (`verdict-plan.md`), overwritten each cycle.

## Documentation updates

- [x] Update `v2/docs/v1-behaviors.md`: plan review is now read-only reviewers (adversary/defender/judge) + a refine-loop executor that applies the verdict under the spec-dir write boundary; reviewers no longer rewrite the spec inline; per-role commits, the verdict → refine seam, and the verdict doc shipping in the spec folder.

## Acceptance criteria

- [x] Plan review runs the three reviewer roles read-only against the spec draft; reviewer roles do not write spec files, and only the refine executor writes the spec.
- [x] The refine loop runs the verdict as its task, under the existing plan write boundary (spec-dir-only, `intent.md` immutable except `## Blocker`).
- [x] Registered plan role prompts exist for adversary, defender, and judge; the judge prompt instructs a self-contained, outcome-altitude verdict.
- [x] Each reviewer role's artifact is injected into the next role's prompt; the executor prompt does not depend on reading prior role artifacts.
- [x] Per-role commits are emitted with plan numbering/resume-suffix conventions; an empty verdict yields no executor run and no executor commit.
- [x] The verdict is persisted in the spec folder (`verdict-plan.md`), overwritten each cycle, and does not register as a subspec pointer in the index.
- [x] Reviewer roles use the review agent order; the refine executor uses the plan agent order (model-class split preserved).
- [x] Tests cover the verdict → refine seam and read-only reviewer enforcement for plan.
- [x] `v2/docs/v1-behaviors.md` reflects the new plan review behavior.
