# 00 - Define the one-shot write entrypoint and core run contract

## Decisions

- Expose Phase 1 through one explicit foreground CLI entrypoint for a single `write` step; do not add workflow selection, step arrays, or detached-run controls.
- Keep the CLI host thin: argv parsing, config lookup, foreground progress text, process exit mapping, and `AbortSignal` wiring live in the CLI host; execution semantics live in the v2 core library.
- Define one host-agnostic core entry for the Phase 1 run path; it accepts explicit inputs and an `AbortSignal` and does not own global process state.
- Treat the Phase 1 source unit as one concrete `write` step contract, not a workflow runner, step graph, or reusable workflow authoring surface.
- Reuse the shared prompt registry and rendering contract; do not add a v2-only prompt store, prompt DSL, or prompt assembly layer.
- Sequence the core path as render prompt -> invoke agent layer -> inspect declared outcome -> verify output contract on terminal success -> materialize result in the worktree.
- Treat `progress` as non-success in Phase 1; the one-shot runner stops immediately without retrying because loop semantics belong to Phase 2.
- Treat `blocked` as a terminal non-success outcome from the core; the CLI surfaces it tersely and exits without fallback.
- Require cancellation to flow through the supplied `AbortSignal` before or during invocation; signal ownership and resume semantics stay out of scope.
- Keep Phase 1 persistence to worktree and git state only; do not add SQLite, metadata files, daemon state, or resume bookkeeping.
- Deferred to first consumer: whether the CLI distinguishes `progress` from other non-terminal outcomes in its public exit surface — pin when the Phase 2 loop consumes it.

## Constraints

- Keep the subspec limited to the CLI host and core contract; agent fallback, output-contract vocabulary, and worktree invariants belong to later subspecs in this tree.
- Keep reuse across `v1/` and `v2/` at stable shared seams only; do not create cross-tree imports that weaken the repo boundary.
- Keep operator output terse and human-readable; structured logs and queryable event schemas stay deferred to Phase 3.

## Assumptions

- Phase 0 scaffolded the v2 CLI entry and repo boundaries, so this subspec can define behavior on top of the existing `v2/src` surface.
- The first real caller of the host-agnostic core is the CLI host only; no second host constrains the API yet beyond `AbortSignal`.

## Task checklist

- Define the Phase 1 CLI surface and its foreground-only contract.
- Define the host-agnostic core run API, inputs, outputs, and cancellation contract.
- Define how the one-shot runner maps core outcomes to terminal status without introducing loop or resume behavior.
- Define which shared prompt-rendering seam Phase 1 reuses and which v1-only plumbing stays out.

## Acceptance criteria

- [ ] The spec names one explicit v2 CLI entrypoint for a foreground, one-shot `write` step and excludes workflow selection, detached execution, daemon controls, and multi-step authoring from Phase 1.
- [ ] The spec defines a host-agnostic core run contract behind that CLI host with explicit inputs, explicit result types, and an `AbortSignal` parameter, and it states that the core does not own global process state or process-signal handlers.
- [ ] The Phase 1 run path is ordered as shared prompt render, agent invocation, outcome inspection, terminal-contract verification, and worktree materialization, with no hidden loop or resume branch.
- [ ] The spec states that `progress` stops the one-shot runner as non-success without retry and that Phase 2 owns loop semantics.
- [ ] The spec states that Phase 1 persistence is the worktree plus git state only and excludes SQLite, metadata files, daemon state, and resume bookkeeping from this slice.
- [ ] The spec keeps operator output to terse foreground progress and terminal outcome text only and defers structured logging and richer event schemas.
- [ ] The spec identifies the shared prompt registry/rendering seam as the reuse point and explicitly excludes a v2-local prompt system from this phase.

## Documentation updates

- None in this subspec; the durable doc alignment for the implemented Phase 1 boundary lands with the end-to-end materialization slice in `02`.
