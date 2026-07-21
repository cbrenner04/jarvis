---
name: implement-pr-body-spec-template
---

# Add the Spec Template to Implement PR Bodies

## Problem

Daemon-backed implement publication omits the deterministic spec template already used by plan and ad-hoc implement publication. Implement PRs therefore lack subspec context, branch commits, risk cues, and the branch diff summary.

## Decisions

- Use `deriveSpecRunBodySummary` for workflow implement completion; rules out an implement-only renderer.
- Preserve plan and intent summary selection; rules out broadening the template to every publication kind.
- Keep template, narrative markers, and attribution in their current order and precedence; rules out changing narrative preservation while adding review context.
- Deferred to first consumer: unifying v1 and v2 PR rendering in `shared/` — pin when a caller needs it.

## Acceptance criteria

- [ ] A workflow implement PR body contains Subspecs, Commits, and Change summary sections derived from its spec tree and branch diff.
- [ ] An implement source-only diff includes the no-test-changes risk cue.
- [ ] `v2/src/execution/workflow-runner.test.ts` plan and intent body-summary tests stay green.
- [ ] The implement template renders before the preserved narrative marker block and regenerated attribution footer.
- [ ] Workflow publication regression coverage fails before the change and passes after it.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — implement PR body composition.
- `v2/docs/v1-behaviors.md` — align the v2 template source record with workflow implement publication.

## Prerequisites

- Spec-run PR summary derivation already renders subspecs, commits, risk cues, and branch diff statistics.
