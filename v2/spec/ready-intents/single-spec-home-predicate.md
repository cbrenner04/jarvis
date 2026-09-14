---
name: single-spec-home-predicate
---

# Every workflow decides in-repo vs external spec home from one predicate

One exported predicate, reading the project `specs` key, replaces `effectivePublishGit`, `chainedStageEffectivePublishGit`, and `planSourcePublishesExternally`. Intent and plan publication, implement admission, chained pipeline stage resolution, and cleanup discovery all call it, so they can no longer disagree.

## Acceptance criteria

- [ ] A project with no `specs` key publishes intent, plan, and implement artifacts to the external home; `specs: "repo"` publishes to `<repo>/<targetDir>`; pinned by tests across intent, plan, implement admission, chained pipeline resolution, and cleanup discovery.
- [ ] Exactly one in-repo-vs-external predicate exists in `v2/src`; the three legacy predicates are removed.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/spec-guidance.md`, `v2/docs/operator-runbook.md` § spec locations, `v2/docs/daemon-host.md` § Git-disabled chained plan artifacts, `v2/docs/first-workflow-walkthrough.md`, `v2/docs/pipeline-execution.md` — reword "Git-disabled / no-commit" to "external spec home".
- `v2/docs/v1-behaviors.md` — record that implement/cleanup now agree with publication on spec home.

## Prerequisites

- `v2/src/paths.ts` exports `specsHome(projectKey)` and every external spec path is built through it.
- Project config exposes a validated `specs: "external" | "repo"` key defaulting to `"external"`, with legacy spec-home keys rejected.
