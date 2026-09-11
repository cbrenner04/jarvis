---
name: daemon-bulk-dismiss-request
---

# Daemon dismiss request accepts a filter selection and answers with a count

The `dismiss` RPC takes exactly one run id. Extend it to accept, alternatively, the dimension filters `run list` already handles (at minimum project, exact-match), dismiss the matching terminal rows plus their step rows via the store's bulk selection, and respond with the number of rows dismissed. A request carrying both a run id and a filter is refused with a named error rather than silently preferring one. Single-id requests keep their existing response shape and live-run warning behavior.

## Prerequisites

- The state store dismisses a terminal run selection (project filter, step rows included, live rows excluded) in one call and reports the dismissed-row count.
- Bulk dismissal is display-only: rows retained, repeat dismissal preserves the first timestamp, `undismiss` reverses it.
- The daemon already resolves `run list` dimension filters with exact-match semantics.

## Acceptance criteria

- [ ] A daemon test proves a `dismiss` request carrying a project filter dismisses that project's terminal rows and their step rows, and responds with the dismissed-row count; it fails against the current id-only handler.
- [ ] A daemon test proves a `dismiss` request carrying both a run id and a filter is refused with a named error and dismisses nothing.
- [ ] Existing single-id dismiss/undismiss daemon tests stay green (behavior unchanged for the id form).

## Documentation updates

- `v2/docs/v1-behaviors.md` — record the bulk dismiss request form and its refusal case.
