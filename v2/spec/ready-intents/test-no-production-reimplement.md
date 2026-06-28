---
name: test-no-production-reimplement
---

# Test convention: do not reimplement production logic in doubles

Add a v2 test-writing convention: tests must not reimplement production logic as a local double. Document the daemon run-control handler drift as the worked example.

## Decisions

- Convention lives in `v2/docs/test-writing.md` only — rules out duplicating the rule across per-module doc files.
- Worked example cites the daemon handler factory + `daemon-start-list.test.ts` pattern — rules out abstract guidance without a concrete before/after.
- Deferred to first consumer: automated lint/review enforcement — pin in a follow-on enforcement spec; this intent is documentation only.

## Documentation updates

- `v2/docs/test-writing.md` — add "do not reimplement production logic in test doubles" with daemon run-control handlers as worked example.

## Prerequisites

- `daemon-start-list.test.ts` exercises real run-control handlers via the exported factory over injected fakes.
