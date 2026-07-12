# Publish plan PR titles

## Problem

Plan PRs should identify the drafted spec they contain.

## Decisions

- Plan and reviewed-plan publication use the drafted spec `index.md` H1 — rules out the ready-intent name or timestamped directory.
- Plan retry retains its resolved title durably — rules out falling back after a completed run cannot re-read its original subject.

## Scope

- Supply the drafted index title for plan, reviewed-plan, and reviewed-light plan publication.
- Preserve it through completed-run retry.
- Align durable completion and parity documentation.

## Acceptance criteria

- [ ] A newly created plan, reviewed-plan, or reviewed-light plan PR is titled with its drafted `index.md` H1.
- [ ] Retrying completed plan publication uses its original resolved title when the index can no longer be resolved.
- [ ] Focused plan-workflow and workflow-runner automated tests cover plan publication and durable retry.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

- Update `v2/docs/write-behavior.md` as the completion-publication behavior home.
- Update `v2/docs/first-workflow-walkthrough.md` so its draft-PR example no longer claims a fixed title.
- Update `v2/docs/v1-behaviors.md` with current v2 completion-title behavior and source citations.
