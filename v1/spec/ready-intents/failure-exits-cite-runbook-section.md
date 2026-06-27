---
name: failure-exits-cite-runbook-section
---

# Failure exits cite the runbook section

When a run exits on a failure reason, the operator-facing exit message points at the
relevant `OPERATOR_RUNBOOK.md` section — `see runbook: <section>` — so the interpretation
and recovery recipe are found at the moment they're needed, not re-derived. Keyed by exit
reason to the stably-named scaffolded sections (e.g. a stuck-red completion points at its
recovery recipe). The runbook compounds in value instead of decaying because each costly
exit routes the operator to where the fix lives.

## Prerequisites

- `jarvis init` scaffolds an OPERATOR_RUNBOOK.md with stably-named sections
