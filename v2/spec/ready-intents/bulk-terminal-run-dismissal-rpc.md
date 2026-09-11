---
name: bulk-terminal-run-dismissal-rpc
---

# Expose bulk terminal run dismissal through the daemon

## Prerequisites

- The state store atomically dismisses every previously undismissed terminal run matching an exact project selection, includes terminal step rows belonging to matched workflow-entry invocations, leaves every nonterminal row and lifecycle field unchanged, and returns the number of rows newly dismissed.

## Primary implementation surface

`v2/src/daemon/daemon-run-lifecycle-handlers.ts`

## Problem

The daemon `dismiss` request accepts only `{ runId }`, so clients cannot invoke the store's bulk selection or verify its effect without listing and issuing one request per row.

## Behavior

- The daemon `dismiss` request accepts exactly one of a run ID or an exact project bulk selector, delegates bulk terminal selection to the store, and returns a validated applied result carrying the dismissed-row count without changing live-run execution.

## Decisions

- Preserve the existing single-ID request and response; the bulk selector is additive.
- Refuse missing or competing selectors as `invalid_params`; rules out silently choosing one.
- Return the store-owned count and do not derive candidates from the retained `list` projection.
- Leave `undismiss` and pipeline requests unchanged.

## Acceptance criteria

- [ ] A daemon regression test proves `{ project }` dismisses every matching terminal row and workflow step row, returns the store count, and leaves all nonterminal rows visible and executing; it fails against the pre-fix `{ runId }`-only handler.
- [ ] A daemon test proves a request carrying both `runId` and `project` is refused as `invalid_params` without mutating any row.
- [ ] Existing single-ID dismiss and undismiss daemon tests stay green: `v2/src/daemon/daemon-run-dismiss.test.ts`.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — bulk dismiss parameters, exclusive selector validation, terminal-only store delegation, and count response.
- `v2/docs/v1-behaviors.md` — record the additive bulk daemon request contract.
