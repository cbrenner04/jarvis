# Resolve every workflow PR title at publication

## Problem

Plan and implement workflows can reach publication without a title, so their PRs use the completion-commit subject and lose the change identity in squash history.

## Decisions

- Resolve every new PR title at the shared publication boundary; rules out optional per-workflow title wiring.
- Treat an explicit intent title as authoritative; rules out replacing `intent: <name>` with staged-output identity.
- For an `index.md`, use its first non-empty H1, then its parent-directory basename only when the readable index has no usable H1; rules out the completion-commit subject as fallback.
- For a non-index spec, use its file basename; rules out sibling-index inference.
- Reject missing or unreadable index identity with a named title-resolution error; rules out publishing `jarvis: complete run`.
- Retain the resolved title in completion retry state; rules out re-reading changed or unavailable spec identity on resume.

## Scope

- Replace caller-optional title fallback with shared publication-time resolution for direct write and every workflow preset.
- Resolve plan output only after staged output lands; preserve intent's explicit title.
- Preserve matching open PR titles.
- Cover direct write, implement, plan, reviewed plan, intent, retry, path fallback, and failure behavior.

## Acceptance criteria

- [ ] A new plan, reviewed-plan, direct-write, or implement PR uses the first non-empty H1 from its readable `index.md`.
- [ ] A readable H1-less `index.md` uses its directory basename, while a non-index spec uses its file basename even when a sibling `index.md` exists.
- [ ] Intent and reviewed-intent PRs retain `intent: <name>`.
- [ ] Missing or unreadable index identity fails publication with an error that names title resolution and the spec path; no new PR uses `jarvis: complete run`.
- [ ] Completion-publication retry reuses the title resolved on the first attempt after the source identity changes or becomes unavailable.
- [ ] Matching open PRs keep their existing titles; `v2/src/execution/completion-publisher.test.ts` reuse coverage stays green.
- [ ] New or updated tests in `v2/src/execution/spec-creation-title.test.ts`, `v2/src/execution/write-loop.test.ts`, and `v2/src/execution/workflow-runner.test.ts` cover the title matrix and fail against the pre-fix code.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

- Update `v2/docs/write-behavior.md` with shared publication-time title resolution, durable retry, and named failure behavior.
- Update `v2/docs/v1-behaviors.md` with the v2 port of v1 `getIndexTitle` path fallbacks and the intentional unreadable-index failure.
- Update `v2/docs/first-workflow-walkthrough.md` with spec-derived plan/implement titles, intent titles, basename fallback, and no generic fallback.
