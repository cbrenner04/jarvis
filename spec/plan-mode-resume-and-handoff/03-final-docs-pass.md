# 03 — Final documentation pass

## Problem

Plan mode is feature-complete after this spec series. The docs need a
final consolidation pass: remove forward references to "in flight"
behavior, document `--resume` and the next-steps hint, and make sure
the cross-references between `README.md`, `docs/plan-mode.md`,
`docs/run-loop.md`, `docs/spec-guidance.md`, `docs/AGENTS.md`,
`docs/config.md`, and `docs/worktrees-and-commits.md` are coherent.

## Decisions

- **`docs/plan-mode.md`:**
  - Remove every remaining "(in flight)" / "(forward reference)"
    note. Plan mode is now described entirely in present tense.
  - Add a "Resuming a plan" section: `--resume <spec-path>`,
    optional `--interview-turns` and `--review-passes` flags,
    `r<n>`-suffixed commit subjects, validation rules.
  - Add a "Handoff to `jarvis run`" section: the merge-first rule,
    the printed next-steps block, the warning `jarvis run` prints
    for unmerged plan branches.
  - Add an "Operational reference" section at the bottom listing all
    plan-mode commit subjects (`plan: interview`, `plan: draft`,
    `plan: review N`, `plan: blocker`, plus `r<n>` suffixed
    variants), so reviewers reading a PR can decode the history at
    a glance.
- **`README.md`:**
  - Replace the plan-mode paragraph (which was last edited in
    `spec/plan-mode-interview/04-docs-updates.md`) with a final
    description: three input modes, four phases, draft PR opened
    automatically, merge-first rule, `--resume` for iteration.
  - Make sure `## Commands` lists `jarvis plan --resume <spec-path>`
    as a documented form (alongside the initial-invocation form).
- **`docs/run-loop.md`:** make sure the plan-mode subsection points
  at `docs/plan-mode.md` for full detail. Add one sentence about the
  unmerged-plan-branch warning under the run preflight section.
- **`docs/spec-guidance.md`:** add a final paragraph in the
  "Authoring with `jarvis plan`" subsection describing the `r<n>`
  resume convention and noting that hand-edited specs and
  plan-generated specs are interchangeable from `jarvis run`'s point
  of view.
- **`docs/AGENTS.md`:** confirm the "Plan-mode prompts" note covers
  all four prompts (`interview.md`, `name-only.md`, `draft.md`,
  `review.md`) and that none of them require a non-default
  permission posture.
- **`docs/config.md`:** confirm `planAgentOrder` documentation
  reflects current usage (consumed by interview, draft, and review
  phases). If the consumption description is still phrased as "will
  be consumed in a later spec," correct it.
- **`docs/worktrees-and-commits.md`:** confirm the "Plan-mode
  worktrees" section covers the temp-slot rename, the `(plan)` tag
  in `jarvis cleanup --dry-run`, and lists every plan-mode commit
  subject including `r<n>` resume variants.
- **`AGENTS.md`** (top-level): no changes. The merge-first rule is
  already general enough to cover plan-generated specs.

## Tasks

- [ ] Final pass on `docs/plan-mode.md` per the bullets above.
- [ ] Final pass on `README.md`.
- [ ] Update `docs/run-loop.md` for the plan-branch warning.
- [ ] Add the final paragraph in `docs/spec-guidance.md`.
- [ ] Verify `docs/AGENTS.md`, `docs/config.md`,
  `docs/worktrees-and-commits.md` against the bullets and update
  whatever has drifted.

## Acceptance criteria

- [ ] `docs/plan-mode.md` is the canonical reference and contains no
  forward references to unimplemented behavior.
- [ ] `README.md` describes plan mode in final form.
- [ ] All cross-references between plan-mode docs are consistent
  (no broken or stale links).
- [ ] `bun run check` passes.

## Documentation updates

- This subspec is the documentation update for
  `spec/plan-mode-resume-and-handoff/`.
