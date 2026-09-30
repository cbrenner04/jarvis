# Persist harness ready-flip evidence on run rows

Durable run rows record successful harness `gh pr ready` outcomes so a later republication can tell a harness-flipped PR from an operator-flipped one. This spec is persistence and lookup only; execution writers and republication consumers land in follow-on intents.

## Subspecs

- [x] [00 — Harness ready-flip evidence on run rows](00-harness-ready-flip-evidence-on-run-row.md)
