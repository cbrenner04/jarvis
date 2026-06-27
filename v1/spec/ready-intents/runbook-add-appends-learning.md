---
name: runbook-add-appends-learning
---

# Append a learning to the runbook in place

The operator can append a freshly-learned gotcha/workaround into the project's
`OPERATOR_RUNBOOK.md` in place (e.g. `jarvis runbook add`) instead of hand-editing, so the
runbook accumulates the costly lessons it can't know at init rather than decaying. The
appended entry lands in the right section and can carry its jarvis issue URL. Honor the
operator north star — folding into an existing flow beats a new subcommand where it fits.

## Prerequisites

- `jarvis init` scaffolds an OPERATOR_RUNBOOK.md with stably-named sections (shipped)
