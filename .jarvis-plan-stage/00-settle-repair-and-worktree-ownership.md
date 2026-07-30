# Settle repair and worktree ownership together

## Problem

- An implement run can expose `completed`, `failed`, or `killed` while a finalization repair invocation still owns the managed worktree.
- The live repair can mutate after settlement and retain `.jarvis.lock`, so the next implement launch on the same `(project, branch)` is refused.

## Decisions

- A row may enter `completed`, `failed`, or `killed` only after every outstanding finalization repair invocation is cancelled and its invocation promise settles — rules out terminal visibility while repair can still mutate.
- Terminal cleanup orders repair cancellation and settlement before `.jarvis.lock` release — rules out admitting a second writer while the first repair is live.
- Apply the same cleanup boundary to normal completion, failure, and kill, including kill during repair — rules out success-only cleanup and daemon-exit cleanup.
- Cover ready-gate and mutation repair through their shared invocation lifecycle — rules out fixing only the observed ready-gate caller while leaving the other repair path orphanable.
- Preserve the existing terminal outcome and resumability selected by each path — rules out converting cancellation cleanup into a new outcome.

## Work

- Track finalization repair invocation lifetime through terminal settlement.
- Cancel and join outstanding repair work before persisting `completed`, `failed`, or `killed`.
- Release the owning managed-worktree lock on each covered terminal path after repair has stopped.
- Add regression and mutation-guard coverage for cancellation, ordering, and same-key re-admission.
- Align the durable behavior docs.

## Acceptance criteria

- [ ] `v2/src/execution/write-loop.test.ts` adds a pre-fix-failing terminal-settlement matrix for `completed`, `failed`, and `killed` (including kill during repair) that holds a repair invocation open and asserts its signal is aborted and its promise is settled before the durable row becomes terminal.
- [ ] The repair-settlement matrix covers both ready-gate and mutation repair callers without changing their existing outcome or resumability.
- [ ] `v2/src/commands/workflow.test.ts` adds a pre-fix-failing regression that reaches each covered terminal status, then launches `jarvis run workflow implement` on the same `(project, branch)` and reaches dispatch without `holds worktree lock` or `worktree_claimed`.
- [ ] Each added or modified settlement guard is mutation-pinned: inverting repair cancellation turns the repair-settlement test RED, and inverting terminal lock release turns the same-key launch test RED.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.
- [ ] `v2/docs/write-behavior.md`, `v2/docs/daemon-host.md`, and `v2/docs/v1-behaviors.md` record cancellation-before-terminal-settle and lock release for `completed`, `failed`, and `killed`.

## Documentation updates

- `v2/docs/write-behavior.md` — replace the repair exception to bounded quiescence with cancellation and join before terminal settlement.
- `v2/docs/daemon-host.md` — terminal cleanup releases the managed-worktree lock only after repair stops, including kill during repair.
- `v2/docs/v1-behaviors.md` — v2 finalization repair cancellation and terminal lock-release behavior.
