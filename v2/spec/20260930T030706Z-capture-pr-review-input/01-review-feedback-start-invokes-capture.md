# 01 - Review-feedback start invokes capture

## Problem

Capture alone does not run unless review-feedback workflow admission calls it at the right time: after lane resolution and before the write step is dispatched.

## Decisions

- Review-feedback preset CLI name is `review-feedback` (`jarvis run workflow review-feedback …`) — rules out a standalone `jarvis capture-pr-review` command or a flag on `plan`/`implement`.
- Daemon workflow admission invokes capture only for that preset, immediately after lane resolution yields `{ worktreePath, prNumber, repoCwd }` and before `startWorkflowRun` / first write-loop dispatch — rules out capturing inside the write loop or on operator demand.
- Capture failures (missing `gh`, auth, or API errors) refuse workflow start with a surfaced error; they do not dispatch the write step — rules out best-effort skip that leaves a stale or absent artifact.
- Lane resolution rules (completed plan/implement lane, open PR, refusals) are not defined here — rules out duplicating admission slice scope from `apply-pr-review-feedback-to-a-lane`; this subspec wires capture to the resolver seam admission provides.
- Deferred to first consumer: exact CLI flags and refusal text for lane resolution — pin when the admission ready-intent lands.

## Tasks

- Extend review-feedback workflow admission (preset builder + daemon `handleWorkflowStart` path) so the resolved lane context calls the capture module from subspec `00`.
- Ensure completion staging / dirty-worktree inventories treat `.jarvis/pr-review-input.json` like other harness sidecars (never staged for publication) — mirror existing `.jarvis/` sidecar exclusions if any gap appears.
- Add `v2/src/daemon/review-feedback-start-capture.test.ts` (or extend `daemon-workflow-admission-handlers.test.ts` if the hook lives there) with injected lane resolver + mocked `gh` runner proving capture runs once before workflow execution is invoked and does not run for `plan`/`implement` starts.
- Update `v2/docs/workflow-runner.md` with artifact path, captured fields (including stable ids), refresh timing on review-feedback admission, and PR-only source.

## Acceptance criteria

- [ ] `review-feedback-start-capture.test.ts` test `review-feedback workflow start refreshes capture before write dispatch` fails against the pre-fix admission path and passes after the hook lands.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/workflow-runner.md` — lane-scoped `.jarvis/pr-review-input.json`, PR-sourced threads/comments with stable GitHub ids, automatic refresh on every `review-feedback` workflow start after lane resolution.
