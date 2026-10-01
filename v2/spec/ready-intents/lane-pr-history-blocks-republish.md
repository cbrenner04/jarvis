---
name: lane-pr-history-blocks-republish
---

# Completion publication refuses a fresh PR when lane history is closed or merged

## Problem

`findOrCreatePr` lists only open PRs for head and base, then creates a draft when none match, so resume or recovery republication opens a duplicate after the operator closed or merged the lane PR.

## Decisions

- Before `gh pr create`, list head+base PRs with `--state all`. When no open draft matches, if the newest match is `CLOSED` or `MERGED`, return a named lane outcome with the PR number instead of creating.
- An open draft on the same head+base still wins via the existing resolver; older closed or merged history does not block reuse.
- A failed list probe is inconclusive: do not create; surface a permanent publication failure naming the probe error.
- `CompletionPublisherInput` carries an explicit republish opt-in; when set, closed or merged newest history does not block create (flag name chosen at plan).
- Thread the opt-in from callers unchanged through the publication chain; this intent does not add CLI flags.

## Acceptance criteria

- [ ] `completion-publisher.test.ts`: fake `gh` with newest same-base PR `CLOSED` → no `gh pr create`, lane outcome `lane_pr_closed` with that number; fails against pre-fix `findOrCreatePr`.
- [ ] Same file: newest `MERGED` → no create, lane outcome `lane_pr_merged` with that number; fails against pre-fix create path.
- [ ] Same file: closed history plus a matching open draft → existing draft reused, no create.
- [ ] Same file: republish opt-in on publisher input with only closed history → `gh pr create` runs and confirms a new draft.
- [ ] Same file: list probe throws → no create, permanent publication failure carries the probe cause; fails against pre-fix create-on-empty-open-list.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — head+base PR resolution consults closed and merged history; republish opt-in on publication input.
- `v2/docs/workflow-runner.md` — `findOrCreatePr` no longer opens a fresh draft when newest history is closed or merged unless opt-in is set.
- `v2/docs/v1-behaviors.md` — record the changed completion-publication PR guard.

## Prerequisites
