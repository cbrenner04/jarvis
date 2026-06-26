# Actuator overwrites draft subspec in resolved spec dir

## Problem

The plan review actuator pointed the agent at the bare spec-dir basename
(`<NAME>`) and — unlike the draft prompt — carried **no** imperative
write-boundary rule. The draft prompt anchors writes with
`- **Only write files under \`spec/<NAME>/\`.**` (`prompts/plan/draft.md:47`,
rewritten to the `targetDir`-prefixed path at build time); the actuator prompt
(`prompts/plan/review-actuator.md`) has only a `**Spec directory:** \`<NAME>\``
label and no rule. With the agent's cwd at the worktree root, the actuator wrote
refined subspecs to `<root>/<timestamp-name>/00-*.md` while the resolved spec
dir under `targetDir` kept the verdict-rejected draft. A later `jarvis run` then
read the stale draft. Observed 2026-06-25 on PR #549.

`buildVerdictActuatorPrompt` (`v1/src/modes/plan/verdict-actuator.ts:50-51`)
already does `template.replaceAll("spec/<NAME>/", "${targetDir}/<NAME>/")`, but
the template has no boundary rule for that to rewrite — it only touches the
`spec/<NAME>/intent.md` prose reference, not where the agent writes.

The silent-commit mechanism compounds this: the actuator commit path
(`v1/src/modes/plan/review.ts`, the `git add -A` + `commitPlanReview` block
after `validateReviewOutput`) validates only index existence and intent
immutability — it performs **no** write-boundary check, whereas reviewer roles
already gate on `assertPlanWriteBoundary` (`v1/src/modes/plan/boundary.ts`). So
even with a prompt fix, agent/prompt drift would re-commit out-of-bounds files
with zero enforcement, reproducing PR #549.

## Decisions

- Add to the actuator prompt the same imperative write-boundary rule the draft prompt carries (`- **Only write files under \`spec/<NAME>/\`.**`, rewritten to the `targetDir`/spec-dir prefix at build time), not merely relabel the directory line. Rules out a weaker/no anchor that leaves writes landing at the worktree root.
- Add a structural write-boundary check to the actuator **commit path** (before `git add -A`/commit), mirroring `assertPlanWriteBoundary` as reviewer roles use it. Rules out a prompt-only fix that leaves the silent-commit mechanism unguarded.
- On a boundary violation, remove the stray out-of-bounds path with a mechanism that covers **untracked** files (a newly-created out-of-bounds directory), i.e. `git clean -fd` as `revertSpecTreeEdits` already does — `git checkout -- <path>` does not remove untracked paths. Rules out a tracked-only revert that leaves the stray dir on disk.
- External no-commit path: the actuator commit-path guard is gated on `opts.commit`, so the no-commit flow (flat `specDirPath` outside `targetDir`) is unaffected; the prompt's boundary rule must gain a flat-layout branch mirroring the draft (`draft.ts:66-70`), so the shared-prompt edit does not ship an untested behavior change to the no-commit path. Rules out an implicit, untested no-commit change.
- Actuator prompt is governed/pinned: editing the body requires bumping `revision` in `prompts/plan/review-actuator.md` (currently `2`), regenerating the `@r<n>` rendered snapshot fixture, and updating the test + governance doc revision lines. Rules out a CI break from a body edit with a stale snapshot.
- Regression coverage drives a single-subspec commit-mode pass with `specDirPath` unset (the basename-vs-prefix path where the bug lives), scripts the mock agent to write a stray out-of-bounds file, and asserts the guard catches/reverts it — the injected fake agent does not interpret prompts, so a filesystem outcome is the only real verification. Rules out a tautological prompt-string-only assertion.

## Task checklist

- Add the imperative write-boundary rule to `prompts/plan/review-actuator.md`, with a flat-layout branch in `buildVerdictActuatorPrompt` mirroring the draft's `flatSpecLayout` handling.
- Add a structural write-boundary check to the actuator commit path, reverting any out-of-bounds path (including untracked dirs via `git clean -fd`) and failing the pass rather than committing.
- Bump the actuator prompt `revision`, regenerate the rendered snapshot fixture, and update the revision assertion in `v1/test/prompts/rendered-snapshots.test.ts` and the revision line in `v1/docs/prompt-governance.md`.
- Add plan-side regression coverage (single-subspec, commit-mode, `specDirPath` unset, non-default `targetDir`, timestamped `name`): a stray out-of-bounds write is caught by the guard and no file lands outside the resolved spec dir.
- Update `v2/docs/v1-behaviors.md` actuator entry.

## Acceptance criteria

- [ ] The built actuator prompt anchors writes to `<targetDir>/<NAME>/` (full prefix) via the same imperative write-boundary rule the draft prompt carries; in the external no-commit (flat-layout) case it instead restricts writes to the working directory, mirroring the draft.
- [ ] In a single-subspec commit-mode pass (`specDirPath` unset), when the actuator agent writes a file outside the resolved spec dir, the actuator commit path detects the boundary violation, removes the stray path (including a newly-created untracked `<worktree-root>/<timestamp-name>/` directory), fails the pass, and produces no commit containing the out-of-bounds file.
- [ ] A new plan-side test exercises an actuator pass with `specDirPath` unset, a non-default `targetDir`, and a timestamped `name`, scripting the mock agent to write a stray out-of-bounds file, and asserts the guard catches/reverts it and nothing lands at `<worktree-root>/<timestamp-name>/`.
- [ ] The actuator prompt `revision` is bumped, the `@r<n>` rendered snapshot fixture is regenerated, and `v1/test/prompts/rendered-snapshots.test.ts` asserts the new revision (snapshot test stays green).
- [ ] `v2/docs/v1-behaviors.md` and `v1/docs/prompt-governance.md` record that the actuator writes refined files to the resolved spec dir (full `targetDir` prefix) overwriting the draft in place, that the commit path enforces a write-boundary check, and the new prompt revision.

## Documentation updates

- `v2/docs/v1-behaviors.md`: amend the plan-review actuator entry (the one stating the actuator "applies the verdict to `index.md`/subspec files under the existing plan write boundary") to record that the actuator prompt carries an imperative write-boundary rule directing writes to the resolved spec dir (full `targetDir` prefix, flat-layout branch for no-commit), and that the commit path enforces a structural boundary check that reverts out-of-bounds (incl. untracked) files rather than committing them.
- `v1/docs/prompt-governance.md`: bump the `plan.prompt.review-actuator` revision line (currently `@r2`).
