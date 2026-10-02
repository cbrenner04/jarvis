# Startup recovery settles published linked lanes

## Problem

Startup reconciliation resumes stranded linked rows even after their lane has published or merged.

## Decisions

- Before automatic linked-row resume, inspect durable publication evidence on its invocation or a later invocation on the same project and branch; settle published rows without launching implement. Preserve recovery of unfinished unpublished lanes.

## Tasks

- [ ] Implement the behavior and focused regression coverage.

## Acceptance criteria

- [ ] daemon-reconciliation.test.ts covers open and merged publication evidence, later same-branch evidence, project/branch isolation, and unpublished linked recovery; tests fail against unconditional pre-fix resume.
- [ ] `bun run typecheck`, `bun run check`, `bun run lint:md` and `bun run test:v2` pass; integration coverage runs in CI.

## Documentation updates

- v2/docs/daemon-host.md, v2/docs/operator-runbook.md and v2/docs/v1-behaviors.md describe published-lane recovery.
