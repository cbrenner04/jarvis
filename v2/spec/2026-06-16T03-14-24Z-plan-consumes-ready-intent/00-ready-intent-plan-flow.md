# Ready-intent plan flow

## Problem

Plan mode still treats fresh input as a raw seed and owns intent draft/refine.
After `jarvis1 intent`, fresh plan should consume one reviewed ready-intent and
produce one spec PR.

## Decisions

- Fresh `jarvis1 plan <path>` accepts only an existing `.md` file under the resolved `<targetDir>/ready-intents/` -- rules out arbitrary markdown, `wip-intents/*.md`, old generated `intent.md`, inline text, and missing-path raw seeds.
- A ready-intent must have frontmatter `name:` matching its filename stem and a `## Prerequisites` section, which may be empty -- rules out treating arbitrary frontmatter markdown as plan-ready input.
- Plan derives `<plan-name>` from ready-intent frontmatter `name:` and treats a missing/invalid/mismatched name as a usage error before creating plan artifacts -- rules out name-only fallback or filename inference.
- Invalid ready-intent input leaves no temporary or final branch, worktree, spec directory, or external no-commit spec directory -- rules out observable partial plan artifacts after validation failure.
- Plan copies the ready-intent bytes to the generated spec directory as `intent.md` and leaves the source file untouched -- rules out destructive consumption before prerequisite/work-queue enforcement.
- Fresh committed plan opens/updates the draft PR after `plan: draft`, then continues review and ready transition in the same invocation -- rules out the old pre-draft PR handoff.
- Fresh no-commit plan follows the same ready-intent entry contract and runs draft/review without PR or ready transition -- rules out retaining raw-seed no-commit authoring.
- `--resume-draft` is rejected with guidance to start from a ready-intent or resume from `index.md` -- rules out preserving the removed intent/refine handoff path.
- Ready-intent `Prerequisites` content is prompt context only -- rules out prerequisite validation/enforcement before seed 03.
- Fresh plan's first telemetry phase is `plan_phase: "draft"`, and no `plan_phase: "intent"` or `plan_phase: "refine"` rows appear in attempts or summaries -- rules out preserving removed phases as no-op attempts.
- Existing post-draft resume behavior stays `--resume <index.md>` -- rules out expanding this change into resume redesign.

## Task checklist

- [ ] Update fresh plan argument handling so `<path>` must resolve to `<targetDir>/ready-intents/<name>.md`; reject inline text, missing paths, `wip-intents/*.md`, old generated `intent.md`, and arbitrary markdown with guidance to run `jarvis1 intent` first.
- [ ] Validate frontmatter `name:` and required `## Prerequisites` before creating branch/worktree/spec output in commit and no-commit modes.
- [ ] Create committed plan branch/worktree/spec directory, or no-commit external spec directory, from valid `name:` frontmatter only.
- [ ] Copy the ready-intent byte-for-byte into the generated spec directory as `intent.md` without moving, deleting, archiving, or rewriting the source.
- [ ] Start fresh plan at `plan_phase: "draft"`, then run existing review passes, PR body updates, attribution, quota fallback, telemetry, and committed ready transition.
- [ ] Keep no-commit output aligned with existing no-commit contracts except that fresh input is ready-intent only and there is no PR/ready transition.
- [ ] Remove fresh-run `plan: intent`, `plan: refine`, committed `--resume-draft` handoff, and active `--resume-draft` execution.
- [ ] Keep blocker handling, review-actuator behavior, and post-draft `--resume <index.md>` behavior aligned with existing plan contracts unless directly contradicted here.
- [ ] Update tests for ready-intent location/shape, `Prerequisites` pass-through, frontmatter naming, copied `intent.md`, removed intent/refine attempts, raw-seed rejection, no-commit flow, invalid-input atomicity, and `--resume-draft` rejection.

## Acceptance criteria

- [x] `jarvis1 plan <targetDir>/ready-intents/<name>.md` accepts a ready-intent with matching `name:` frontmatter and `## Prerequisites`, then creates committed branch/worktree/spec output named from `name:` and copies the source bytes to `<targetDir>/<spec-dir>/intent.md` without modifying the source ready-intent.
- [x] With `modes.plan.commit: false`, fresh plan accepts the same ready-intent shape, copies it to external `intent.md`, runs draft/review, prints no-commit next steps, and performs no commit, PR open/update, or ready transition.
- [x] Arbitrary markdown, `<targetDir>/wip-intents/*.md`, old generated `intent.md`, inline fresh plan input, and missing-path raw seeds fail with operator guidance to use `jarvis1 intent` before `jarvis1 plan`.
- [x] Missing, invalid, or filename-mismatched `name:` frontmatter, and missing `## Prerequisites`, fail before any temporary or final branch, worktree, spec directory, or external no-commit spec directory remains.
- [x] The first fresh-plan agent phase and summary attempt label is `plan_phase: "draft"`: no fresh run produces `plan: intent` or `plan: refine` commits, telemetry rows, or summary attempts.
- [x] Draft and review prompts receive the copied ready-intent with frontmatter, sentinels, and `## Prerequisites` preserved; non-empty prerequisites are not blocked, validated, resolved, or enforced.
- [x] Fresh committed plan opens or updates the draft PR after `plan: draft`, continues through review in the same invocation, and attempts the ready transition only after successful draft/review completion.
- [x] `jarvis1 plan --resume-draft <intent.md>` exits with guidance to use `jarvis1 plan <ready-intent>` for fresh work or `jarvis1 plan --resume <index.md>` for post-draft review.
- [x] Existing draft/review behavior still works after the collapsed entry flow: spec files are generated, review passes can update them, blockers stop the run, quota fallback rotates through configured plan agents, PR attribution/body updates occur, and successful committed runs attempt ready transition.
- [x] `bun run typecheck` and `bun test` pass.

## Documentation updates

- `v1/docs/plan-mode.md`: ready-intent input model, collapsed phase shape, removed fresh-run `--resume-draft` handoff, copied `intent.md`, frontmatter naming, and non-enforced prerequisites.
- `v1/docs/spec-guidance.md`: replace fresh raw-seed/inline plan authoring guidance with `jarvis1 intent` then `jarvis1 plan <ready-intent>`.
- `v2/docs/v1-behaviors.md`: update plan flow, telemetry, PR lifecycle, and flow matrix entries.
