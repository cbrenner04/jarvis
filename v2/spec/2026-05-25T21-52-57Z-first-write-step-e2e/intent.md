---
name: first-write-step-e2e
---

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

## Refinement

- Keep the draft to three subspecs max unless a boundary proves non-atomic: thin CLI host + core contract; invocation + quota fallback; worktree materialization + output contract + required doc alignment.
- Define the phase-1 source unit as one concrete `write` step contract, not a workflow runner or reusable workflow authoring surface.
- Reuse the shared top-level prompt registry/rendering contract; do not introduce a v2-only prompt store, prompt DSL, or prompt assembly layer in this phase.
- Treat the phase-1 success rule as asymmetric-both: the agent returns an outcome token and the runner deterministically verifies the declared artifact contract before the step passes.
- Invocation outcomes must separate `blocked`, fallback-eligible quota exhaustion, and non-fallback process failure; only quota exhaustion advances to the next agent.
- If the one-shot runner receives `progress`, it must stop as non-success without retrying; Phase 2 owns loop semantics.
- Deferred to first consumer: whether the single-run CLI surface exposes `progress` distinctly from other non-terminal outcomes — pin when the Phase 2 loop consumes it.
- The first output-contract vocabulary should be the minimum needed for one write artifact and repo-boundary checks; do not spec generic contract primitives ahead of later steps.
- Phase-1 persistence is the worktree and git state only; metadata files are out unless one is strictly required to make the single-run contract machine-checkable.
- Keep the CLI surface to one explicit one-shot entrypoint; defer workflow selection, step arrays, and per-project binding UX to the first multi-step consumer.
- Cancellation in scope means the core accepts an `AbortSignal` and callers can stop before or during invocation; signal ownership, daemon mediation, and resume semantics stay out.
- Foreground operator output in this phase should be terse, human-readable progress and terminal outcome text only; structured logs and queryable event schemas stay deferred to Phase 3.
- Durable doc alignment for this phase belongs in existing `v2/docs/v2-build-order.md` and `v2/docs/v2-architecture.md` when their statements become false; do not add a new phase-1 usage doc.
- Supersedes the current daemon-first `### Interface` sequencing in `v2/docs/v2-architecture.md`: Phase 1 is CLI host first, daemon host later in Phase 3.
- Materialize the verified write result in a worktree under `~/.jarvis/worktrees`; defer retention policy, reuse policy, and cleanup UX to the first lifecycle consumer that needs them.
- Phase-1 worktree setup must preserve `.jarvis.lock` coexistence as a repository invariant; defer broader multi-run locking/admission policy to Phase 7.

