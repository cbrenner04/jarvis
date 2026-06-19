---
name: classify-claude-zero-exit-quota-result
---
# Classify Claude zero-exit quota results

## Summary

Classify Claude's zero-exit JSON envelope as `quota` only when it reports
`is_error: true`, `api_error_status: 429`, and a quota message. Preserve its
diagnostics so patch mode rotates to the next configured agent. Successful
envelopes and unrelated structured errors remain non-quota.

## Decisions

- Require semantic 429 and a quota message; do not treat every zero-exit structured error as quota.
- Classify at the Claude spawn boundary; do not add a patch-mode special case, so existing quota fallback remains the sole rotation path.

## Acceptance signals

- The reported monthly-spend-limit JSON shape with exit 0 is `kind: "quota"` and retains diagnostics.
- Ordinary successful Claude JSON and zero-exit non-quota error JSON are not `kind: "quota"`.
- A patch run falls from that Claude result to the next configured agent.
- Regression coverage exercises the spawn/classification boundary and patch fallback with the reported shape.
- `bun run typecheck` and `bun test` pass.

## Documentation updates

- `v1/docs/quota-signals.md`: verified monthly-spend-limit JSON sample and zero-exit quota behavior.
- `v2/docs/v1-behaviors.md`: Claude zero-exit quota classification and fallback behavior.

## Out of scope

- New fallback policy or changes to non-Claude agent classification.

## Prerequisites

- Claude terminal JSON output is parsed at the agent spawn boundary.
- Patch mode rotates the configured agent order for `kind: "quota"` results.

## Blocker

- Need the complete reported zero-exit Claude JSON envelope; only its three required predicates are available, so an exact verified fixture cannot be specified without inventing fields.
