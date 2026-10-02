# Force kill clears a retiring owner’s stranded row

## Problem

A live retiring daemon identity blocks force-killing a non-terminal row even when that daemon has no active execution for it.

## Decisions

- Use direct-owner execution evidence before overriding live ownership; force kill may settle a proven inactive row, while active or unobservable live owners retain existing routing and safety.

## Tasks

- [ ] Implement the behavior and focused regression coverage.

## Acceptance criteria

- [ ] daemon-run-lifecycle-kill.test.ts, daemon ownership-routing tests and state-store.test.ts prove a live owner with no active execution can settle killed with force, active owners are routed normally, and unavailable ownership evidence cannot authorize force; tests fail against pre-fix refusal.
- [ ] `bun run typecheck`, `bun run check`, `bun run lint:md` and `bun run test:v2` pass; integration coverage runs in CI.

## Documentation updates

- v2/docs/operator-runbook.md, v2/docs/daemon-host.md and v2/docs/v1-behaviors.md describe force-kill owner evidence.
