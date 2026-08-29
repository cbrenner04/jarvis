---
name: terminal-state-honesty-invariant
---

# Terminal transitions write cause and evidence atomically with status

## Problem

The largest defect class in the 2026-07-15→08-29 fix stream (~48 of 237 fixes across "settlement honesty" and "the row lied") is one mechanism: a run reaches a terminal outcome in memory but the durable row keeps a pre-terminal or downgraded value, or gains `completed` before its evidence exists. Instances: publication failure reported `completed` (#abd9105e-class), a gate timeout kill recorded as a red gate, a surviving mutation settling the row only from one step, `setPrEvidence` running after the run was durably `completed` (#3036 subspec 00 fixed one site). Each was fixed point-wise; nothing prevents the next settle path from repeating it.

## Decisions

- One settle helper owns every terminal write: status, cause (`loopOutcomeKind`/operator error), and evidence (PR fields, failure detail) land in one transaction; no call site writes a terminal status directly. Rules out per-path hand-ordering of evidence vs status.
- An audit pass inventories existing terminal writes and routes them through the helper; each divergent site is a listed, checked-off migration. Rules out the invariant applying only to new code.
- A structural guard (lint rule or test over the store API surface) fails when a terminal status is written outside the helper. Rules out silent regression.

## Acceptance criteria

- [ ] The settle helper exists and a store-level test proves status+cause+evidence are atomic (a crash between them is unobservable), pinned.
- [ ] Every production terminal write routes through it, pinned by the structural guard turning red on a direct write.
- [ ] A settlement observer reading `completed` always finds the evidence the terminal action needs, pinned by a test that fails against an evidence-after-status ordering.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/state-store.md` — the terminal-write contract.
- `v2/docs/workflow-runner.md` — settle paths route through the single helper.
