---
name: opencode-quota-classification-in-v2
---

# Classify opencode quota, model-config, and transient errors in v2

The shared classifier in `shared/invocation/agents.ts` only knows claude,
codex, and cursor signals; for any other agent `quotaPatternsFor` defaults to
the claude quota table, and the model-config and transient tables have no
opencode-specific entries. So opencode's own failure signals are misclassified:
its quota exhaustion may not shift the escalation ladder, its
provider-config error is not treated as a terminal model-config error, and its
guarded HTTP 500 / `UnknownError` stall is not retried as transient.

Teach the classifier opencode's signals so the outer/inner escalation loops
behave correctly for opencode rungs: opencode quota patterns (e.g. rate limit,
quota exceeded, insufficient_quota, guarded 429) drive quota escalation; the
opencode-only `no provider configured for` message classifies as a terminal
model-config error; and the opencode-only guarded HTTP 500 (including
`UnknownError` context) classifies as transient and retries.

Observable behavior: an opencode invocation returning a quota message escalates
off the rung; one returning `no provider configured for` stops terminally as a
model-config error; one returning a guarded 500 is retried rather than treated
as a hard failure.

## Prerequisites

- opencode is invocable in v2 (opencode is a recognized agent in the shared invocation registry, not the unwired terminal error)
