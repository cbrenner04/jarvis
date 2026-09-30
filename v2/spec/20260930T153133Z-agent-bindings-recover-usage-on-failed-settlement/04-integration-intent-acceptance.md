# 04 — Integration: intent acceptance for binding usage recovery

Subspecs 00–03 land slice-by-slice; this subspec owns the intent-level proof that stream-json and codex bindings together recover usage on failed settlement and telemetry reflects it.

## Decisions

- No new production code beyond test/doc glue unless a gap remains after 00–03 — rules out duplicating binding logic here.
- Integration tests use injected fixtures only — rules out ambient agent sessions or machine config.

## Tasks

- Add or extend `agents.test.ts` and `execute.test.ts` coverage so the intent checklist is satisfied in one place without re-asserting codex-only or finalize-only outcomes already owned by 02/03.
- Run `bun run typecheck`, `bun run test:shared`, and `bun run test:integration:shared`.

## Acceptance criteria

- [ ] Injected stream and codex-session fixtures in `shared/invocation` binding tests (`agents.test.ts`, and `execute.test.ts` where telemetry is required) prove usage survives non-ok exit and abort teardown, cumulative stream events are not double-counted, fallback attempts keep separate usage, missing counters stay null, and both a pre-result failure with no usage and a failure after partial usage are covered; no ambient agent sessions or machine config; fails against pre-fix bindings that settle non-ok without stream or rollout recovery.
- [ ] `bun run typecheck`, `bun run test:shared`, and `bun run test:integration:shared` pass.

## Documentation updates

- None (docs owned by subspecs 02–03).
