# 01 — Structural guard on `.jarvis` `homedir()` resolution

Prevents reintroducing a jarvis-home sink that bypasses `jarvisHome()`.

## Decisions

- Guard flags a `homedir()` (or `process.env.HOME`) expression joined with a `".jarvis"` segment in non-test source under `shared/**` and `v2/src/**`, allowing only `shared/paths.ts`; rules out a blanket `homedir()` ban, which would flag the codex home resolver.
- Test fixtures (`*.test.ts`, `v2/src/testing/**`) are exempt; they build temp homes, not the operator home.
- Guard test includes a synthetic positive sample proving the matcher fires, so a matcher that never matches cannot pass.

## Acceptance criteria

- [ ] A new structural test `shared/jarvis-home-structural-guard.test.ts` fails when a source file other than the shared resolver joins `homedir()` with `".jarvis"`; its synthetic-violation case fails against a no-op matcher, and it would have flagged the pre-fix session-log resolver.
- [ ] The same test asserts `shared/invocation/agents.ts`'s `.codex` sessions resolver is not flagged.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:shared` and `bun run test:integration:shared` pass.

## Documentation updates

- None: guard is self-describing; test-writing guidance lands in 02.
