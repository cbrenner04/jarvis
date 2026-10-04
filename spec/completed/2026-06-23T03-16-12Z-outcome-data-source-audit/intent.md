---
name: outcome-data-source-audit
---

# Audit existing logs to decide outcome data: log vs schema

## Problem

Cost CSVs track spend/tokens but not what spend bought. Before adding any outcome
logging we must know which proposed outcome columns are already captured, derivable,
or genuinely missing — otherwise we risk adding harness behavior we don't need.

## Behavior

Produce a recorded audit that inventories what `~/.jarvis/runs.jsonl` and the
telemetry JSONL already record (agent, model, duration, exit reason, token/cost
buckets per run/attempt), then classifies each proposed outcome column into one of:

1. **Already logged** — change is a CSV-schema extension + scripted derivation, no
   harness behavior change.
2. **Derivable but not surfaced** — computable from existing logs (e.g. `agent_count`
   / `duration_minutes` from `runs.jsonl`, `files_touched` from the run diff).
3. **Genuinely not captured** — would require a narrow logging/telemetry addition,
   recorded as a follow-up rather than done here.

The audit is the load-bearing decision for the schema and population work and biases
toward (1)/(2) over (3). It is a recorded classification, not a runtime change.

## Prerequisites

