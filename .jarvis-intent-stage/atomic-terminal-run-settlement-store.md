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
- Route store-owned completion-boundary, guarded-kill, and restart-reconciliation terminal writes through the shared transactional primitive without changing their guards or idempotency.
- Prove with a store-level injected fault that readers observe either the entire terminal settlement or none of it.
- Document the terminal-write contract in `v2/docs/state-store.md` and record the changed v2 behavior in `v2/docs/v1-behaviors.md`.

## Decision ledger

- The terminal-settlement input carries the existing terminal cause and evidence needed by current consumers, including PR fields and failure detail; rules out separate evidence setters around the status write.
- Nonterminal status changes remain outside the terminal-settlement operation; rules out coupling pause, resume, queue, and in-progress transitions to terminal evidence.
- Store-owned guarded transitions delegate to the shared primitive while retaining their existing conditional predicates; rules out weakening kill and reconciliation race protection to obtain one write path.
- The repository-wide caller guard lands after dependent call-site migrations; rules out making this independently mergeable persistence foundation fail on known legacy callers.

## Prerequisites
