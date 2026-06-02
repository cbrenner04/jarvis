# 02 - Report review passes in telemetry and durable docs

## Problem

Patch review adds a new post-completion agent phase with its own cost, token,
and stop semantics. Without explicit telemetry and doc updates, end-of-run
reporting will either hide review cost inside implementation totals or leave
v1/v2 durable references describing the old completion flow.

## Decisions

- Telemetry distinguishes implementation and review invocations with an explicit patch-phase field; do not infer review rows later from commit subjects or prompt IDs.
- End-of-run summaries aggregate review usage into the same run total while labeling review attempts separately; do not double-count review rows as extra implementation iterations.
- Durable operator docs stay in the existing v1 workflow pages, and v2 parity tracking is updated in `v2/docs/v1-behaviors.md`; do not add a second competing behavior catalog for this change.

## Task Checklist

- [ ] Extend run telemetry rows so review invocations are tagged distinctly from implementation iterations and can be priced without ambiguity.
- [ ] Update the human-readable end-of-run summary so review attempts/cost appear alongside implementation attempts without inflating iteration counts or totals.
- [ ] Update tests for telemetry enrichment and run-summary rendering so mixed implementation/review runs report stable counts and costs.
- [ ] Update durable docs that describe shipped run behavior: `v1/docs/run-loop.md`, `v1/docs/workflows.md`, `README.md`, and `v2/docs/v1-behaviors.md`.
- [ ] Review adjacent v2 durable docs that enumerate v1 behavior surfaces and update them only if they would otherwise misstate patch-mode completion semantics.

## Documentation updates

- [ ] In `v2/docs/v1-behaviors.md`, add the review-loop behavior to the patch-mode run workflow, git/loop-only distinctions, PR lifecycle, and telemetry sections that now change observably.
- [ ] Keep `README.md` to a short run-flow mention; the detailed contract remains in `v1/docs/run-loop.md` and `v1/docs/workflows.md`.

## Acceptance criteria

- [ ] `~/.jarvis/runs.jsonl` rows emitted for review passes are distinguishable from implementation iterations without inspecting commit messages.
- [ ] The end-of-run stdout summary shows review attempts and cost separately from implementation attempts while preserving correct run totals.
- [ ] `v1/docs/run-loop.md`, `v1/docs/workflows.md`, and `README.md` describe patch review as a post-completion phase before PR readiness.
- [ ] `v2/docs/v1-behaviors.md` records patch review as a shipped v1 behavior that v2 must preserve, change, or drop explicitly.
- [ ] No updated doc page still implies that patch mode goes directly from checklist completion to `bun run ready` / `gh pr ready`.
