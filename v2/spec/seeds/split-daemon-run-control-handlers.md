---
name: split-daemon-run-control-handlers
---

# Break up `createRunControlHandlers`; retire the daemon's test back-channels

## Problem

`createRunControlHandlers` (`daemon.ts:1000-2317`) is a 1,318-line closure holding 20 RPC handlers and ~30 nested helpers over shared mutable captured state (`activeRuns`, `waitAbortControllers`, `retiring`, `workflowPromisesByEntryRunId`, …). Nothing inside is independently testable; tests reach it through a `WeakMap` back-channel (`activeRunsByHandler`, `daemon.ts:155/2310`). The same file carries module-global mutable test seams in production: `let writeLoopBindingSourceDeps` with `set/resetWriteLoopBindingSourceDepsForTests` (`daemon.ts:430-437`), and `commands/workflow.ts:38-46` has two more `...ForTest` module lets consumed on the real path. `scripts/guard-production-test-flags.ts` misses all of them (it regexes one historical identifier family). Tail-streaming (`daemon.ts:2319-2458`) and peer-socket discovery (`:2461-2543`) have zero coupling to the rest and can move out immediately.

## Decisions

- Handlers move to modules taking an explicit shared-state context object; the closure becomes wiring. Rules out the WeakMap back-channel — tests construct the context directly.
- Module-global mutable test seams are replaced with injected deps (constructor/args); the `...ForTests` setters are deleted. Rules out production globals whose only writers are tests.
- `guard-production-test-flags.ts` generalizes to flag any `ForTest`/`ForTests` identifier or module-level mutable seam in `src/` outside `testing/`. Rules out the guard covering only the last incident.
- Behavior-preserving refactor; RPC contracts unchanged, pinned by existing daemon tests re-pointed at the modules. Rules out contract drift riding along.

## Acceptance criteria

- [ ] Each RPC handler group lives in its own module with direct tests; `activeRunsByHandler` is deleted, pinned by its absence plus green re-pointed tests.
- [ ] No module-level mutable test seam remains in production code; the generalized guard turns red when one is introduced, pinned by a guard self-test.
- [ ] Existing daemon test assertions all survive (count + titles vs baseline), pinned by a recorded comparison.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — handler module map.
- `v2/docs/test-writing.md` — constructing the daemon handler context in tests.
