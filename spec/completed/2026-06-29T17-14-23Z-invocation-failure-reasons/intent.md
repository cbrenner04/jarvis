---
name: invocation-failure-reasons
---

# Typed invocation failure reasons

Wire existing step-runner invocation failure classification through to durable state and operator output. When a binding chain ends without usable output, the loop records and reports the stable reason category already produced by `step-runner.ts`, the attempted bindings, and whether quota fallback was exhausted or a terminal non-quota failure stopped the chain.

## Scope

- Propagate `failureKind` (`quota` | `model_config` | `error` | `no_binding`) from the step runner through the write loop — no new taxonomy.
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
- Store the existing closed `failureKind` set plus binding attempt summary — rules out raw stderr as the durable contract.
- Treat `no_binding` as its own invocation failure reason — rules out collapsing setup absence into generic agent error.
- Category names are the `step-runner.ts` `failureKind` union — rules out inventing a parallel taxonomy in this slice.

## Documentation updates

- `v2/docs/shared-invocation.md` — document terminal reason categories and fallback boundary.
- `v2/docs/write-behavior.md` — document the operator-visible invocation failure payload.
- Inline doc-comments for exported failure types.

## Prerequisites

- Shared invocation returns ordered binding attempts and advances fallback only on quota.
- The write loop persists per-attempt outcomes and reports `invocation_failure`.
- `step-runner.ts` already classifies terminal invocation failures as `failureKind` (`quota` | `model_config` | `error` | `no_binding`).
