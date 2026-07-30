# Quiesce repair before terminal settlement

## Problem

- A finalization repair can remain live after its run exposes `completed`, `failed`, or `killed`, and can still mutate the managed worktree.

## Decisions

- Settlement is a single boundary: cancel repair, join its process and invocation promise, release the physical lock and daemon registry claim through their owners, then expose `completed`, `failed`, or `killed`.
- Abort signaling or a bounded quiescence wait is insufficient. A non-cooperative repair leaves the row nonterminal and ownership retained until it actually settles.
- Ready-gate/publication and mutation repair use this boundary on applicable fresh and resumed workflows; `blocked` and `interrupted` are outside this repair-settlement scope.
- Each path keeps its existing terminal outcome and resumability.

## Work

- Track every finalization repair invocation through settlement.
- Cancel and join outstanding repair work before a covered durable terminal status is written.
- Add realistic repair-lifecycle regressions and mutation guards for cancellation, joining, and terminal ordering.
- Document cancellation and joining before terminal settlement.

## Acceptance criteria

- [ ] `v2/src/execution/write-loop.test.ts` adds a pre-fix-failing matrix using real ready-gate/publication and mutation-repair settlement writers, across applicable fresh and resumed workflows, for `completed`, `failed`, and `killed` (including kill during repair). Each case states and asserts its expected terminal outcome and resumability, holds repair open, and proves the repair signal is aborted and both its process and invocation promise settle before the durable row becomes terminal.
- [ ] The matrix proves that a repair which ignores cancellation leaves the row nonterminal and retains ownership after any bounded wait, until the repair process and invocation promise actually quiesce.
- [ ] `v2/src/execution/write-loop.test.ts` ready-finalization outcome tests and `v2/src/execution/workflow-runner.test.ts` mutation-repair outcome tests stay green.
- [ ] Inverting abort propagation, invocation joining, or terminal-status ordering turns its corresponding repair-settlement regression RED.
- [ ] `v2/docs/write-behavior.md` records cancellation and join before covered terminal settlement, including the non-cooperative-repair behavior.

## Documentation updates

- `v2/docs/write-behavior.md` — replace bounded-quiescence terminal settlement with cancellation and join before terminal visibility.
