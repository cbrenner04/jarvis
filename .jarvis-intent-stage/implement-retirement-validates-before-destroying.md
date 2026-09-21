---
name: implement-retirement-validates-before-destroying
---

# Implement stale-workspace retirement validates rematerialization before destroying artifacts

Unsplit rationale: validation, refusal, and tip-SHA reporting all live in the implement preflight retirement path; one surface.

## Primary implementation surface

- `v2/src/commands/workflow.ts` (implement preflight stale-workspace retirement)

## Prerequisites

## Behavior

- Before removing worktree/branches/PR, validate `--base` resolves to a real commit and is not (nor resolves to) the branch being retired; on failure refuse with a named message and destroy nothing. Extend the `validateExplicitPlanBase` (#3948) pattern.
- `--base` == retired branch is a named pre-mutation refusal (no `git branch X X`).
- If retirement destroys artifacts and a later step fails, the `Retirement destroyed artifacts:` output includes the retired branch's tip SHA.

## Acceptance criteria

- [ ] Re-run with `--base` resolving to the retired branch refuses before any destruction, naming the collision; pinned by a test.
- [ ] Any base-validation failure leaves worktree, local branch, remote branch, and PR intact; pinned by a test.
- [ ] Post-destruction failure output includes the retired branch tip SHA; pinned by a test.
- [ ] Existing successful retirement + rematerialize tests in `v2/src/commands/workflow.test.ts` stay green.
- [ ] `bun run typecheck`, `bun run test:v2`, `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — base==branch refusal, validate-before-destroy, tip-SHA recovery.
- `v2/docs/workflow-runner.md` (or `daemon-host.md`, whichever owns retirement ordering) — pre-validation precedes destructive steps.
