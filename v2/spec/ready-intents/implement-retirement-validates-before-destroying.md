---
name: implement-retirement-validates-before-destroying
---

# Implement stale-workspace retirement validates rematerialization before destroying artifacts

Unsplit rationale: validation, refusal, and tip-SHA reporting all live in the implement preflight retirement path; one surface.

## Primary implementation surface

- `v2/src/commands/workflow.ts` (implement preflight stale-workspace retirement)

## Prerequisites

## Behavior

- Before removing worktree/branches/PR, validate `--base` resolves to a real commit and does not name the branch being retired; on failure refuse with a named message and destroy nothing. Extend the `validateExplicitPlanBase` (#3948) pattern.
- Collision is by ref name, not SHA: `X`, `refs/heads/X`, and `<remote>/X` (incl. `refs/remotes/<remote>/X`) all collide with retired branch `X`; a distinct branch at the same commit does not.
- When retirement has destroyed artifacts and any later step fails, the `Retirement destroyed artifacts:` output includes the retired branch's local tip SHA, and the remote tip SHA too when it differs.

## Acceptance criteria

- [ ] Re-run with `--base` equal to the retired branch, in exact-name and `refs/heads/X`/`<remote>/X` alias forms, refuses before any destruction, naming the collision; pinned by a test. A distinct branch at the retired tip's SHA is not refused.
- [ ] Any base-validation failure leaves worktree, local branch, remote branch, and PR intact; pinned by a test.
- [ ] A rematerialization failure after destruction prints the retired local tip SHA (and the remote tip SHA when it differs) in `Retirement destroyed artifacts:`; pinned by a test.
- [ ] Existing successful retirement + rematerialize tests in `v2/src/commands/workflow.test.ts` stay green.
- [ ] `bun run typecheck`, `bun run test:v2`, `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — base==branch refusal, validate-before-destroy, tip-SHA recovery.
- `v2/docs/workflow-runner.md` — pre-validation precedes destructive retirement steps.
- `v2/docs/v1-behaviors.md` — record the new refusal and validate-before-destroy ordering.
