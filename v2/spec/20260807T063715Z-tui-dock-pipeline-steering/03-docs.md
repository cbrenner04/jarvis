# Docs

## Problem

Operator docs still list `approve`/`reject`/`resume` as unavailable dock verbs with CLI fallbacks. In-TUI pipeline steering is undocumented in the parity catalog.

## Prerequisites

- Subspec `02-entry-dispatch` merged.

## Decisions

- All operator-facing semantics for this feature live in one documentation pass — rules out split or empty doc sections across parser/dispatch subspecs.
- The runbook documents live verb eligibility, named ineligible feedback codes, success (`pipelineId` on the status row), and verbatim daemon refusal — rules out stale CLI-fallback rows.
- `stale_non_targetable` means a retained pipeline or stage row has no live owning daemon client in the current refresh — rules out implying RPC will reach a disconnected socket.
- `resume` on an awaiting-approval pipeline is dock-eligible when the row is a non-terminal pipeline selection but may be refused by the daemon; operators should use `approve`/`reject` at the gate — rules out implying dock resume substitutes for gate decisions.
- Correct the Shift+Enter claim in the dock section (doc-only, per overhaul brief).

## Work

- Update `v2/docs/operator-runbook.md` § Observe / Dock commands: list `approve`/`reject`/`resume` as live verbs with eligibility and outcomes; drop their CLI-fallback table rows; document `stale_non_targetable` and awaiting-resume daemon refusal; fix Shift+Enter.
- Update `v2/docs/v1-behaviors.md` to record in-TUI pipeline steering.

## Acceptance criteria

- [ ] `v2/docs/operator-runbook.md` § Dock commands lists `approve`, `reject`, and `resume` as live verbs with eligibility, named ineligible codes, success (`pipelineId`), and verbatim refusal semantics; CLI-fallback rows for these verbs are removed; `stale_non_targetable` and awaiting-resume daemon refusal are documented; the Shift+Enter claim is corrected.
- [ ] `v2/docs/v1-behaviors.md` records in-TUI `approve`/`reject`/`resume` pipeline steering.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe / Dock commands — `approve`/`reject`/`resume` are live dock verbs with eligibility and outcome semantics; correct the Shift+Enter claim.
- `v2/docs/v1-behaviors.md` — record in-TUI pipeline steering.
