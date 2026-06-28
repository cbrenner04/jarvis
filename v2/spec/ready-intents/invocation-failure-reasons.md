---
name: invocation-failure-reasons
---

# Typed invocation failure reasons

Make write-loop invocation failures explainable without another agent call. When a binding chain ends without usable output, the loop records and reports a stable reason category, the attempted bindings, and whether quota fallback was exhausted or a terminal non-quota failure stopped the chain.

## Scope

- Classify shared invocation terminal failures into stable reason categories.
- Preserve quota-only fallback behavior.
- Persist the final reason with the attempt outcome.
- Surface the reason in `jarvis write` output and tests.
- Keep messages terse; no transcript dump.

## Out of scope

- Retrying non-quota failures.
- Daemon/TUI rendering.
- New agent process adapters beyond the existing binding seam.

## Decisions

- Keep fallback quota-only — rules out trying later agents after model config or agent crashes.
- Store a closed reason category plus binding attempt summary — rules out raw stderr as the durable contract.
- Treat no configured bindings as its own invocation failure reason — rules out collapsing setup absence into generic agent error.
- Deferred to first consumer: exact category names — pin when tests assert serialized output.

## Documentation updates

- `v2/docs/shared-invocation.md` — document terminal reason categories and fallback boundary.
- `v2/docs/write-behavior.md` — document the operator-visible invocation failure payload.
- Inline doc-comments for exported failure types.

## Prerequisites

- Shared invocation returns ordered binding attempts and advances fallback only on quota.
- The write loop persists per-attempt outcomes and reports `invocation_failure`.
