# Intent

Draft the next implementation spec from [`v2/spec/v2-meta-index.md`](../v2-meta-index.md): "First write step, end-to-end."

This is the first v2 spec after the scaffold work. The point is to
prove the real execution path once, from the v2 CLI down to a materialized
worktree result, without pulling the loop, daemon, workflow runner, or durable
state forward.

The intended slice is narrow:

- one `write` step
- run exactly once from the v2 CLI
- host-agnostic execution core behind the CLI host
- prompt render -> agent invocation -> outcome capture -> output-contract check -> worktree write
- quota fallback in the invocation layer

The spec should preserve the sequencing in [`v2/docs/v2-build-order.md`](../../docs/v2-build-order.md):
This is the first working step, not the first version of every later system.
Anything that exists only to support looping, resume, detached execution,
cross-step workflows, or PR automation belongs to a later phase unless this phase
needs a tiny seam to avoid painting us into a corner.

Likely shape of the spec:

- an index with a small number of atomic subspecs, probably around:
  - core run contract and CLI entry for a single write step
  - agent invocation and quota fallback
  - worktree materialization and deterministic output-contract enforcement
  - minimal docs for how the new v2 path behaves

The draft spec should make the this phase's boundary explicit:

- no loop
- no SQLite or other durable run state
- no daemon host or IPC
- no TUI
- no multi-step workflows
- no PR lifecycle work

Important design constraints to carry into the real spec:

- Keep the execution engine honest as a library boundary from day one. The core
  run path should be callable without the CLI owning global process state.
- Cancellation should work through `AbortSignal`, even if we only proves a
  thin version of that contract.
- The CLI should stay a thin host over the core, not the place where execution
  logic accretes.
- Persistence for this phase is the worktree plus git state only. If metadata
  needs to exist, it should be the minimum needed for the single-run contract,
  not a premature resume system.
- Quota fallback is in scope because this is where the first real agent
  invocation lands.
- The output contract should be deterministic and inspectable. A run
  must have a clear machine-checkable result, not just "the agent ran."

Questions the real spec should answer tightly:

- What exact CLI surface exposes the one-shot write step in v2?
- What is the minimal output contract for a successful write step?
- Where does the rendered output land in the worktree, and what repository
  invariants must hold before and after the write?
- What constitutes an invocation outcome for fallback purposes?
- What must be logged or surfaced to users now, versus deferred until structured
  logging exists?
- Which pieces of v1 prompt assembly or agent plumbing can be reused directly,
  and which need a v2-local seam to keep cross-tree boundaries intact?

Risks to keep visible while refining:

- accidentally smuggling resume/state concerns into this work
- letting the CLI contract sprawl before there is a loop runner
- overdesigning the library boundary before the first real caller exists
- under-specifying the output contract, leaving success/failure ambiguous
- coupling this work too tightly to one agent implementation so fallback becomes a
  retrofit

Documentation for the eventual spec should stay small and concrete. Prefer
updating the v2 docs that describe build order, architecture, or operator
surfaces only where the implemented behavior makes those docs stale.
Avoid writing broad usage docs for future phases.
