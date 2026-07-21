# A test double that calls production code cannot fail when production is wrong

## Problem

`makeIpcClient` in `v2/src/testing/cli-test-helpers.ts` — the fake daemon used by CLI dispatch
tests — imports and calls the production function it is standing in for:

```ts
// v2/src/testing/cli-test-helpers.ts:4
import { advanceLoadedRevision } from "../cli/dispatch-revision.ts";
// :83
const loadedRevision = advanceLoadedRevision(…);
```

So the fake's reply is computed by the same code under test. Whatever production does, the double
agrees, and the assertion compares a value to itself.

Measured on PR #1880 (2026-07-21): reverting the entire new dispatch guard in
`dispatch-revision.ts` — undoing the change the spec exists to make — produced **0 test failures**
across 144 tests in 7 files. Separately, gutting the daemon's `statusHandler` (dropping both the
revision advance and `loadedExecutableDigest` from the reply) also produced **0 failures**: nothing
exercises the real daemon's status wiring, and the one sandbox-unrunnable assertion only checks
`typeof loadedRevision === "string"`.

This is why mutation verification cleared a PR whose daemon could never dispatch (see
`runtime-smoke-cannot-observe-component-interaction`). Mutation testing asks "does any test fail
when I change this guard?" — a double that mirrors the guard guarantees the answer is no. The
gate is not weak here; it is being fed a rigged oracle.

The general shape, worth catching beyond this one instance: a fixture under `v2/src/testing/**`
importing from a non-testing production module in order to *compute* the value it returns, rather
than to build a type or reuse a constant.

## Decisions

- A test double must not compute its response with the production function whose behavior the test
  asserts; doubles return fixed or test-authored values. Rules out "reuse production for
  convenience" in fakes.
- Distinguish legitimate production imports in fixtures (types, enums, shared constants, builders)
  from behavioral reuse; only the latter is banned. A blanket import ban would be unworkable.
- Prefer a static guard over review vigilance, in the spirit of
  `scripts/guard-deterministic-daemon-tests.ts`: flag value-producing calls to production functions
  inside `v2/src/testing/**` doubles. Pin the exact detection rule in the plan — start from the
  known case and keep false positives near zero.
- Independently, the CLI↔daemon dispatch contract needs at least one test that drives the **real**
  daemon status handler, so the guard is pinned by something other than a fake.
- Rules out deleting the fake; CLI dispatch tests need it for speed.

## Acceptance criteria

- [ ] `makeIpcClient` no longer calls `advanceLoadedRevision` (or any production behavior it is
      standing in for); its replies are test-authored.
- [ ] With that change, reverting the dispatch guard in `dispatch-revision.ts` fails at least one
      test.
- [ ] Gutting the daemon `statusHandler`'s revision advance or `loadedExecutableDigest` reply fails
      at least one test.
- [ ] A guard flags value-producing production calls inside `v2/src/testing/**` doubles, with the
      known case as its fixture, and runs as part of `bun run check`.
- [ ] The guard does not flag type-only, constant, or builder imports; a fixture pins allowed uses.
- [ ] `bun run typecheck`, `test:v2` pass.

## Documentation updates

- `v2/docs/test-writing.md` — test doubles must not compute responses from the code under test, and
  what the guard enforces.
- `v2/docs/operator-runbook.md` § Gate trust — mutation verification is only as good as the oracle;
  a self-referential double defeats it.
