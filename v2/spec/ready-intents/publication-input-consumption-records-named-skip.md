---
name: publication-input-consumption-records-named-skip
---

# Skipped publication input consumption records a named reason on the run

## Problem

`consumePublicationInputs` and `publication-landing` treat missing, out-of-root, or non-duplicated inputs as deliberate best-effort: no delete and no durable signal. Operators only notice orphaned queue files on `main`. Contract: a consumed input is deleted by the landing that consumed it, or the run says why not.

## Decisions

- Each skipped input path yields one `snake_case` reason id from a fixed catalog colocated with `consumePublicationInputs` (structure is the contract; plan maps one id per skip branch); rules out silent `continue` in `publication-input-consumption.ts` without surfacing outcome.
- Skips persist on the completing run row as `{ path, reason }[]` (plan names the run-row field); rules out workflow-only or terminal-summary-only recording.
- Successful landing with partial skips still records skips on the completing run row; rules out failing publication solely because a stale optional input could not be deleted.
- Resume replays the same consumption set from persisted `landingInputs`; skip recording uses the same path on first pass and resume.

## Prerequisites

- Plan-tree and intent-stage landings invoke shared publication input consumption when `landing.inputs` is present.
- Workflow snapshots persist `landingInputs` on write steps for resume replay.
- Plan landing resolves consumption targets from the actual read source (not `project.root` when the plan read elsewhere).

## Acceptance criteria

- [ ] A test drives `landPublication` or `landReviewedPublicationOutput` with `landing.inputs` where consumption cannot complete (reachable on main: missing target, path outside `sourceRoot`, or worktree mode without a matching worktree copy) and asserts the completing run row carries a catalog `reason` per skipped path in its persisted skip list; fails against the current silent no-op.
- [ ] `shared/publication-input-consumption.test.ts` stays green for successful delete paths.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — publication landing reports named consumption skip reasons on the run when deletion does not occur.
- `v2/docs/v1-behaviors.md` — catalog visible consumption skips versus silent best-effort.
