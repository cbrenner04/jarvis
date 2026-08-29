---
name: atomic-terminal-run-settlement-store
---

# Make terminal run settlement atomic in persistence

## Primary implementation surface

Persistence

## Problem

The state store exposes several ways to make a run terminal, while cause and evidence can be written separately. A committed terminal row can therefore be visible without the data needed to explain or act on that outcome.

## Behavior

- Add one state-store terminal-settlement operation that commits terminal status, finish metadata, cause, and supplied evidence in one SQLite transaction.
- Provide the shared transactional primitive without taking ownership of callers' terminal-transition decisions or guards.
- Prove with a store-level injected fault that readers observe either the entire terminal settlement or none of it.
- Document the terminal-write contract in `v2/docs/state-store.md` and record the changed v2 behavior in `v2/docs/v1-behaviors.md`.

## Decision ledger

- The terminal-settlement input carries the existing terminal cause and evidence needed by current consumers, including PR fields and failure detail; rules out separate evidence setters around the status write.
- Nonterminal status changes remain outside the terminal-settlement operation; rules out coupling pause, resume, queue, and in-progress transitions to terminal evidence.
- Persistence owns the transaction and common settlement data; daemon owns guarded-kill and restart-reconciliation admission, and execution owns completion-boundary admission; rules out duplicate transition ownership or weakening conditional predicates to obtain one write path.
- The repository-wide caller guard lands after dependent call-site migrations; rules out making this independently mergeable persistence foundation fail on known legacy callers.

## Prerequisites
