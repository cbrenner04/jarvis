---
name: run-dismiss-bulk-cli
---

# `jarvis run dismiss` takes a bulk filter instead of one id per call

Shedding a project's terminal rows today is a `run list | awk | xargs` pipe, and the default `run list` retention cap makes the list appear to refill as slots free. Teach `run dismiss` the same dimension filters `run list` accepts (at minimum `--project <name>`), scoped to terminal rows, covering step rows under matched workflow-entry rows, and print how many rows were dismissed. Passing both a positional run id and a bulk filter is refused with a named error. If `pipeline dismiss` falls out of the same helper, extend it too; do not force it.

## Prerequisites

- The state store dismisses a terminal run selection (project filter, step rows included, live rows excluded) in one call and reports the dismissed-row count.
- The daemon `dismiss` request accepts dimension filters, answers with a dismissed-row count, and refuses a request carrying both a run id and a filter.
- `run list` exposes `--project` with exact-match semantics.

## Acceptance criteria

- [ ] A CLI test proves `run dismiss --project <name>` dismisses every terminal row for that project and no live row; it fails against the current single-id-only signature.
- [ ] A CLI test proves step rows under a matched workflow-entry row are dismissed by the same invocation.
- [ ] A CLI test proves the command reports how many rows it dismissed.
- [ ] A CLI test proves passing both a positional run id and a bulk filter is refused with a named error.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — § Run dismiss and undismiss covers the bulk form and states that the default `run list` retention cap is why a partially-dismissed list appears to refill.
- `v2/docs/v1-behaviors.md` — record the bulk `run dismiss` operator surface.
