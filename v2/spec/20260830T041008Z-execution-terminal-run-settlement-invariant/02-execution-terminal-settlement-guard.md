# Execution terminal settlement guard and docs

Authoritative for the execution production guard and cross-doc alignment: acceptance criteria, documentation updates, and material decisions in this file supersede `intent.md` where they differ.

## Problem

After subspecs 00 and 01 migrate callers, nothing in `v2/src/execution/` prevents a future direct terminal `setRunStatus`, standalone `setPrEvidence` before terminal visibility, or a reintroduced duplicate post-boundary status write. Operator docs still describe hand-ordered evidence and status on several execution tails.

## Decision ledger

- The structural guard scans every production `v2/src/execution/**/*.ts` file except tests and test-support, classifies `setRunStatus` and `commitCompletionBoundary` `runStatus` arguments, and fails on any terminal status write outside `commitTerminalRunSettlement` or `commitCompletionBoundary` with terminal `runStatus` after persistence delegates through settlement; rules out a convention-only invariant.
- The guard inventory is explicit and fail-closed: new terminal write sites must update the allowlist or migrate to settlement; rules out silently permitting unknown call shapes.
- Guard tests mutate the real scanner predicates rather than production inversion hooks; rules out `invert*ForTest` exports or test-only bypass paths in production modules.
- `setRunStatus` remains permitted for nonterminal statuses (`in-progress`, `paused`, `queued`, `budget-soft-stopped`, etc.); rules out banning legitimate mid-loop status transitions.
- Cross-doc alignment records execution-owned settlement ownership in `workflow-runner.md`, `write-behavior.md`, `state-store.md`, and `v1-behaviors.md` without duplicating daemon-owned kill/reconcile prose; rules out stale hand-ordered completion text contradicting the migrated code.

## Prerequisites

- [00 - Write-loop terminal settlement](./00-write-loop-terminal-settlement.md) merged.
- [01 - Workflow-runner terminal settlement](./01-workflow-runner-terminal-settlement.md) merged.

## Tasks

- Add a production-source audit test under `v2/src/execution/` that fails when any non-test execution source introduces terminal `setRunStatus`, standalone `setPrEvidence`, or terminal `commitCompletionBoundary` without the settlement-delegation contract.
- Keep an explicit inventory of permitted terminal write sites (file, function, and status) that must match the migrated tree; the test fails when the inventory and scanner disagree.
- Align `v2/docs/workflow-runner.md`, `v2/docs/write-behavior.md`, `v2/docs/state-store.md`, and `v2/docs/v1-behaviors.md` with execution-owned atomic settlement and the completed-observer contract.
- Add a guard mutation checkpoint proving the scanner catches a deliberately reintroduced forbidden terminal `setRunStatus` in a scratch production path.

## Acceptance criteria

- [ ] `v2/src/execution/execution-terminal-settlement-guard.test.ts` test `execution production terminal writers are restricted to atomic settlement` scans production execution sources, fails against the pre-migration tree where `write-loop.ts` and `workflow-runner.ts` call `setRunStatus` with terminal literals, and passes only when terminal run-row commits go through `commitTerminalRunSettlement` or settlement-backed `commitCompletionBoundary` as inventoried.
- [ ] `v2/src/execution/execution-terminal-settlement-guard.test.ts` test `guard rejects reintroduced terminal setRunStatus` embeds a `// @mutate` directive that adds a forbidden terminal `setRunStatus` to a listed production file and proves the scanner turns RED when applied; reachable on main today because no execution production guard exists.
- [ ] `v2/docs/workflow-runner.md` names atomic terminal settlement for every workflow-owned completion, publication, pre-publication, shrink/review, and resume tail covered by subspec 01, with no remaining instructions to persist PR evidence before a separate terminal status write.
- [ ] `v2/docs/write-behavior.md` aligns completion and publication semantics with atomic settlement, immediate completed-row PR evidence, and durable failure cause/detail for execution-owned tails.
- [ ] `v2/docs/state-store.md` states that execution-owned terminal run writers are `commitTerminalRunSettlement` and settlement-backed `commitCompletionBoundary` only, distinct from daemon-owned settlement.
- [ ] `v2/docs/v1-behaviors.md` records execution-loop atomic terminal settlement, the completed-observer contract, and failure cause/detail durability.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — settlement routing and immediate observer contract for workflow-owned terminals.
- `v2/docs/write-behavior.md` — execution completion/publication/repair terminal settlement semantics aligned with migrated code.
- `v2/docs/state-store.md` — execution versus daemon terminal writer ownership after caller migration.
- `v2/docs/v1-behaviors.md` — execution-loop terminal settlement invariant and observer contract.
