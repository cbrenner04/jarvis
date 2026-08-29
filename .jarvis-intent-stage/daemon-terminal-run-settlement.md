---
name: daemon-terminal-run-settlement
---

# Route daemon terminal outcomes through atomic settlement

## Primary implementation surface

Daemon

## Problem

Daemon lifecycle and request handling still contain terminal status paths whose cause or evidence is recorded separately or only in adjacent log state. Immediate list and wait observers can therefore see a terminal row without a matching durable explanation.

## Behavior

- Inventory every production terminal transition under `v2/src/daemon/` and route each through the state-store terminal-settlement operation.
- Preserve guarded kill, owner-liveness, startup reconciliation, queue, and resume behavior while making each terminal row carry its available cause and failure evidence atomically.
- Add daemon regressions proving immediate list and wait observation reports the terminal status and matching operator error from the same settlement.
- Document daemon settlement ownership in `v2/docs/daemon-host.md` and record the changed v2 behavior in `v2/docs/v1-behaviors.md`.

## Decision ledger

- Daemon callers supply the terminal cause and available evidence at the transition they own; rules out reconstructing cause later from whichever log record happens to be newest.
- Existing conditional kill and reconciliation admission remains authoritative before settlement; rules out converting guarded no-ops into unconditional terminal writes.
- Nonterminal recovery writes remain on the nonterminal state-store path; rules out treating resume or queue promotion as terminal settlement.

## Prerequisites

- The state store provides one transaction that commits terminal status, finish metadata, cause, and supplied evidence, and its fault-injection test proves partial terminal visibility is impossible.
