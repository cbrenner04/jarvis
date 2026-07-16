# 00 - Rehydrate review profiles at execution

## Problem

Daemon JSON transport preserves review policy but drops profile render callbacks, so daemon-run reviews fail before their roles execute.

## Decisions

- Persist `profile.domain` with existing serializable policy and resolve the executable profile from one domain registry immediately before review dispatch; rules out serializing callbacks or retaining live profile objects across JSON transport.
- Rehydrate both `review` and `review-debate` through the same execution path for intent, plan, and implement; rules out builder-, domain-, or mode-specific repair.
- Exercise JSON-round-tripped workflow steps at the daemon boundary; rules out coverage that executes only in-memory builder output.

## Scope

- Add one domain-to-executable-profile registry for intent, plan, and implement.
- Restore render callbacks before light or debate review execution without changing serialized policy.
- Cover critic, actuator, adversary, advocate, and adjudicator rendering after JSON transport.

## Out of scope

- Review policy, prompt content, cycle behavior, and domain enforcement remain unchanged.
- Stale review-verdict owner cleanup remains unchanged.

## Acceptance criteria

- [x] A regression test in `v2/src/daemon/daemon-workflow-start.test.ts` JSON-round-trips daemon workflow input and proves intent, plan, and implement review profiles render after reload in light and debate modes; it fails against the pre-fix code.
- [x] Each JSON-round-tripped light review invokes rendered critic and non-empty-verdict actuator prompts.
- [x] Each JSON-round-tripped debate review invokes rendered adversary, advocate, adjudicator, and non-empty-verdict actuator prompts.
- [x] Review policy, rendered prompt output, cycle behavior, and domain enforcement tests stay green in `v2/src/execution/review-cycle.test.ts`, `v2/src/execution/review-debate.test.ts`, and `v2/src/execution/workflow-runner.test.ts`.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.
- [x] `v2/docs/workflow-runner.md` defines serializable profile identity and execution-time registry rehydration at the daemon boundary.
- [x] `v2/docs/v1-behaviors.md` records daemon-run review rendering after JSON transport for v2 parity review.

## Documentation updates

- `v2/docs/workflow-runner.md` — document profile identity serialization and execution-time renderer restoration.
- `v2/docs/v1-behaviors.md` — align the parity baseline with daemon-run intent, plan, and implement review rendering.
