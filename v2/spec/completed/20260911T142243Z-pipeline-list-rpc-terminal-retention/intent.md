---
name: pipeline-list-rpc-terminal-retention
---

# Retain terminal pipelines in the default RPC projection

## Prerequisites

- `pipeline_list` projects durable pipelines and derived states, excludes dismissed rows unless `includeDismissed: true`, and never mutates pipeline state.
- `loadPipeline` and `listPipelines` expose every durable pipeline and its stages after state-store reopen.

## Primary implementation surface

- Daemon pipeline request handling (`v2/src/daemon/daemon-pipeline-handlers.ts`)

## Problem

Default `pipeline_list` returns every stored pipeline, so every consumer receives an unbounded terminal history.

## Behavior

Default `pipeline_list` returns every non-terminal pipeline plus the 50 newest terminal pipelines, matching run-list display retention. An explicit `sinceMs` or derived-state query bypasses that terminal cap. Durable rows remain unchanged and directly loadable.

## Decisions

- Apply retention after the default dismissed-row exclusion; `includeDismissed` changes membership but does not become a history query, matching run-list semantics.
- Treat `pending`, `running`, and `awaiting-approval` as non-terminal and never remove them from the default projection because of age or count.
- Rank terminal pipelines deterministically by durable `createdAt` newest-first, matching the run policy; use `pipelineId` as the tie break.
- Accept epoch-millisecond `sinceMs` and exact derived-state RPC filters, compose them conjunctively, and bypass the default terminal cap when either is present; filter `sinceMs` inclusively on `createdAt` and return newest-first.
- Preserve all `pipelines`, `pipeline_stages`, and `pipeline_stage_admission` rows; rules out deletion, pruning, or dismissal as retention.

## Acceptance criteria

- [ ] A daemon regression test seeds more than 50 terminal pipelines and proves default `pipeline_list` returns only the newest 50 terminals plus every non-terminal pipeline; it fails against the pre-fix code.
- [ ] The default projection includes old `pending`, `running`, and `awaiting-approval` pipelines regardless of terminal volume.
- [ ] `pipeline_list { sinceMs }` returns a terminal pipeline beyond the default cap when its `createdAt` meets the inclusive cutoff.
- [ ] An exact derived-state query returns matching terminal pipelines beyond the default cap and composes with `sinceMs`.
- [ ] A beyond-cap pipeline remains loadable by id with all durable stages after default and historical list requests.
- [ ] Dismissal filtering composes with default retention and `sinceMs`; a dismissed row consumes no default slot and appears only with `includeDismissed: true`.

## Documentation updates

- `v2/docs/daemon-host.md` — default 50-terminal retention, always-visible non-terminal states, filtered-query bypass, dismissal ordering, and durable-state invariants.
- `v2/docs/v1-behaviors.md` — `pipeline_list` no longer returns every stored pipeline by default.
