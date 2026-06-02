# 02 - Report review passes in telemetry and durable docs

## Problem

Patch review changes run telemetry and operator-visible workflow docs.

## Decisions

Tag review invocations with an explicit patch-phase field, not inferred later from commit subjects or prompt names.
Show review attempts and cost separately in the run summary while keeping one correct run total, not inflated implementation counts.
Record shipped behavior in the existing durable homes: `README.md`, `v1/docs/run-loop.md`, `v1/docs/workflows.md`, and `v2/docs/v1-behaviors.md`, not a new behavior catalog.

## Task Checklist

- [ ] Extend run telemetry rows so review invocations are tagged distinctly from implementation iterations and can be priced without ambiguity.
- [ ] Update the human-readable end-of-run summary so review attempts/cost appear alongside implementation attempts without inflating iteration counts or totals.
- [ ] Update tests for telemetry enrichment and run-summary rendering so mixed implementation/review runs report stable counts and costs.
- [ ] Update durable docs that describe shipped run behavior: `v1/docs/run-loop.md`, `v1/docs/workflows.md`, `README.md`, and `v2/docs/v1-behaviors.md`.
- [ ] Review adjacent v2 durable docs that enumerate v1 behavior surfaces and update them only if they would otherwise misstate patch-mode completion semantics.

## Documentation updates

- [ ] Update `README.md` with a short run-flow mention only.
- [ ] Update `v2/docs/v1-behaviors.md` where patch-mode workflow, git/loop-only behavior, PR lifecycle, or telemetry would otherwise be wrong.

## Acceptance criteria

- [ ] `~/.jarvis/runs.jsonl` rows emitted for review passes are distinguishable from implementation iterations without inspecting commit messages.
- [ ] The end-of-run stdout summary shows review attempts and cost separately from implementation attempts while preserving correct run totals.
- [ ] `v1/docs/run-loop.md`, `v1/docs/workflows.md`, and `README.md` describe patch review as a post-completion phase before PR readiness.
- [ ] `v2/docs/v1-behaviors.md` records patch review as a shipped v1 behavior that v2 must preserve, change, or drop explicitly.
- [ ] No updated doc page still implies that patch mode goes directly from checklist completion to `bun run ready` / `gh pr ready`.
