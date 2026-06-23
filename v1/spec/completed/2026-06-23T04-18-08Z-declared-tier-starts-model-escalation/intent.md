---
name: declared-tier-starts-model-escalation
---

# Declared tier selects the initial model-escalation rung

## Problem

Known-hard work wastes a cheap actuator attempt; trivial work should not start expensive. Per-run
hardness inference would make selection non-deterministic.

## Direction

Record `tier: trivial|standard|hard` once with runnable work. A tier selects the initial
`agentOrder` rung; subsequent no-progress escalation continues from that rung. The operator can
override the recorded tier before execution. No runtime inference selects a tier or rung.

## Decisions

- Record tier once in durable work metadata, not per-run inference; the latter breaks deterministic selection.
- Make tier selection choose a ladder start and retain ordinary escalation, not a separate model policy; the latter duplicates failure recovery.
- Deferred to first consumer: tier-to-rung table ownership and applicable modes — pin when a caller needs it.
- Deferred to first consumer: intent/plan default versus operator-only tier stamping — pin when a caller needs it.

## Documentation

- Document the operator-visible tier syntax, override, start-rung behavior, and deterministic boundary in the durable operator/workflow home selected by `v2/docs/documentation-standard.md`.
- Update `v2/docs/v1-behaviors.md` if this changes v1 behavior.

## Prerequisites

- Patch no-progress advances through the configured agent/model ladder before exit 4.
