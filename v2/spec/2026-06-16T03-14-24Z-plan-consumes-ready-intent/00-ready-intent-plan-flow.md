# Ready-intent plan flow

## Problem

Plan mode still treats fresh input as a raw seed and owns intent draft/refine.
After `jarvis1 intent`, fresh plan should consume one reviewed ready-intent and
produce one spec PR.

## Decisions

- Fresh `jarvis1 plan <path>` requires an existing ready-intent file, not inline text or a missing-path seed -- rules out preserving raw-seed compatibility in plan.
- Plan derives `<plan-name>` from ready-intent frontmatter `name:` and treats a missing/invalid name as a usage error -- rules out name-only fallback or filename inference.
- Plan copies the ready-intent to the generated spec directory as `intent.md` and leaves the source file untouched -- rules out destructive consumption before prerequisite/work-queue enforcement.
- Fresh committed plan runs draft, review, and ready transition in one invocation -- rules out the old `plan: intent`/`plan: refine` PR handoff and `--resume-draft` requirement.
- Ready-intent `Prerequisites` content is prompt context only -- rules out prerequisite validation/enforcement before seed 03.
- No `plan_phase: "intent"` or `plan_phase: "refine"` telemetry rows are emitted by fresh plan -- rules out preserving removed phases as no-op attempts.
- Existing post-draft resume behavior stays `--resume <index.md>` -- rules out expanding this change into resume redesign.

## Task checklist

- [ ] Update fresh plan argument handling so `<path>` must resolve to a ready-intent file and inline/missing-path raw seeds fail with guidance to run `jarvis1 intent` first.
- [ ] Create the plan worktree/branch/spec directory from ready-intent `name:` frontmatter; fail fast when `name:` is missing or invalid.
- [ ] Copy the ready-intent into the generated spec directory as `intent.md` without moving, deleting, or archiving the source.
- [ ] Start fresh plan at the draft phase, then run the existing review passes, PR body updates, attribution, quota fallback, telemetry, and ready transition.
- [ ] Remove fresh-run `plan: intent`, `plan: refine`, and committed `--resume-draft` handoff from the active flow.
- [ ] Keep blocker handling, review-actuator behavior, no-commit output, and post-draft `--resume <index.md>` behavior aligned with existing plan contracts unless directly contradicted here.
- [ ] Update tests for ready-intent input, `Prerequisites` pass-through, frontmatter naming, copied `intent.md`, removed intent/refine commits, and raw-seed rejection.

## Acceptance criteria

- [ ] `jarvis1 plan <ready-intent-file>` creates a plan branch/worktree/spec directory named from `name:` frontmatter and copies the consumed file to `<targetDir>/<spec-dir>/intent.md` without modifying the source ready-intent.
- [ ] The first fresh-plan agent phase is spec drafting: no fresh committed run produces `plan: intent` or `plan: refine` commits, no fresh plan summary includes `plan_phase: "intent"` or `plan_phase: "refine"` attempts, and no `--resume-draft` handoff is required before draft/review.
- [ ] Draft and review prompts receive the full copied ready-intent, including `## Prerequisites`, while non-empty prerequisites are not blocked, validated, resolved, or enforced.
- [ ] Inline fresh plan input and missing-path raw seeds fail with operator guidance to use `jarvis1 intent` before `jarvis1 plan`.
- [ ] Missing or invalid ready-intent `name:` frontmatter fails before creating a final plan branch/worktree or spec output.
- [ ] Existing draft/review behavior still works after the collapsed entry flow: spec files are generated, review passes can update them, blockers stop the run, quota fallback rotates through configured plan agents, PR attribution/body updates occur, and a successful committed run attempts the ready transition.
- [ ] `bun run typecheck` and `bun test` pass.

## Documentation updates

- `v1/docs/plan-mode.md`: ready-intent input model, collapsed phase shape, removed fresh-run `--resume-draft` handoff, copied `intent.md`, frontmatter naming, and non-enforced prerequisites.
- `v1/docs/spec-guidance.md`: replace fresh raw-seed/inline plan authoring guidance with `jarvis1 intent` then `jarvis1 plan <ready-intent>`.
- `v2/docs/v1-behaviors.md`: update plan flow, telemetry, PR lifecycle, and flow matrix entries.
