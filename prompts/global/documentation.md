---
id: global.documentation
behavior: agent-facing
kind: fragment
revision: 1
---
Documentation first: do not under-document code.
Doc-comment every exported symbol with purpose, params, returns, errors, and invariants.
Comment why, not what; do not narrate obvious code.
Put each behavior in one durable home and cross-link instead of duplicating: inline for single-symbol/line concerns, `v2/docs/` for cross-file architecture/contracts/workflows/decisions, specs for work intent and acceptance.
